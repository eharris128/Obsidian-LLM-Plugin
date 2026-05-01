/**
 * AgentLoop — streaming agentic loop for tool-calling providers.
 *
 * Both Anthropic and OpenAI-compatible paths stream text to the UI in real
 * time. Tool calls are detected inside the stream itself; when one arrives the
 * loop pauses, shows the permission card, executes the tool, then issues the
 * next streaming request — completely seamlessly from the user's perspective.
 */

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { App } from "obsidian";
import { ChatParams, PermissionMode } from "Types/types";
import { ObsidianToolRegistry } from "services/ObsidianToolRegistry";
import { toAnthropicTools, toOpenAITools } from "services/ToolAdapters";

/** Called by ChatContainer to render the approval card and await the user's choice. */
export type ShowPermissionUI = (
	toolName: string,
	toolDescription: string,
	input: Record<string, any>
) => Promise<boolean>;

export interface AgentCallbacks {
	/** Called once before the first API request — show thinking animation. */
	onStart: () => void;
	/** Called with each text chunk as it arrives from the model. */
	onChunk: (text: string) => void;
	/** Called between tool execution and the next API request — re-show thinking. */
	onThinking: () => void;
}

export class AgentLoop {
	private registry: ObsidianToolRegistry;

	constructor(
		private app: App,
		private permissionMode: PermissionMode,
		private showPermissionUI: ShowPermissionUI
	) {
		this.registry = new ObsidianToolRegistry(app);
	}

	// ---------------------------------------------------------------------------
	// Permission gate
	// ---------------------------------------------------------------------------

	private async checkPermission(
		toolName: string,
		input: Record<string, any>
	): Promise<boolean> {
		const risk = this.registry.getRisk(toolName);
		const description = this.registry.getDescription(toolName);

		switch (this.permissionMode) {
			case "auto-approve":
				return true;
			case "read-only":
				return risk === "safe";
			case "ask-everything":
				return this.showPermissionUI(toolName, description, input);
			case "ask":
			default:
				if (risk === "safe") return true;
				return this.showPermissionUI(toolName, description, input);
		}
	}

	// ---------------------------------------------------------------------------
	// Anthropic (Claude models) — streaming
	// ---------------------------------------------------------------------------

	async runAnthropic(
		params: ChatParams,
		apiKey: string,
		callbacks: AgentCallbacks
	): Promise<string> {
		const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
		const tools = toAnthropicTools(this.registry.getTools());

		type ClaudeMsg = { role: "user" | "assistant"; content: any };
		const messages: ClaudeMsg[] = params.messages
			.filter((m) => m.role !== "system")
			.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

		callbacks.onStart();
		let fullText = "";
		let firstCall = true;
		const toolSummaries: string[] = [];

		while (true) {
			if (!firstCall) callbacks.onThinking();
			firstCall = false;

			// --- Streaming request ---
			const stream = await client.messages.create({
				model: params.model,
				max_tokens: params.tokens || 4096,
				temperature: params.temperature,
				...(params.systemContext ? { system: params.systemContext } : {}),
				tools,
				messages,
				stream: true,
			});

			// Block accumulators keyed by index
			interface TextAcc { type: "text"; text: string }
			interface ToolAcc { type: "tool_use"; id: string; name: string; inputJson: string }
			const blocks = new Map<number, TextAcc | ToolAcc>();
			let stopReason: string | null = null;
			let seenFirstChunk = false;

			for await (const event of stream) {
				if (event.type === "content_block_start") {
					const cb = event.content_block;
					if (cb.type === "text") {
						blocks.set(event.index, { type: "text", text: "" });
					} else if (cb.type === "tool_use") {
						blocks.set(event.index, {
							type: "tool_use",
							id: cb.id,
							name: cb.name,
							inputJson: "",
						});
					}
				} else if (event.type === "content_block_delta") {
					const block = blocks.get(event.index);
					const delta = event.delta;
					if (block?.type === "text" && delta.type === "text_delta") {
						if (!seenFirstChunk) seenFirstChunk = true;
						block.text += delta.text;
						fullText += delta.text;
						callbacks.onChunk(delta.text);
					} else if (block?.type === "tool_use" && delta.type === "input_json_delta") {
						block.inputJson += delta.partial_json;
					}
				} else if (event.type === "message_delta") {
					stopReason = event.delta.stop_reason ?? null;
				}
			}

			// Build typed content array for the assistant turn
			const assistantContent: Anthropic.ContentBlockParam[] = [];
			for (const block of blocks.values()) {
				if (block.type === "text") {
					assistantContent.push({ type: "text", text: block.text });
				} else {
					let input: Record<string, any> = {};
					try { input = JSON.parse(block.inputJson || "{}"); } catch { /* ignore */ }
					assistantContent.push({
						type: "tool_use",
						id: block.id,
						name: block.name,
						input,
					});
				}
			}

			if (stopReason !== "tool_use") break;

			// Execute tool calls and collect results
			const toolResults: Anthropic.ToolResultBlockParam[] = [];
			for (const block of blocks.values()) {
				if (block.type !== "tool_use") continue;
				let input: Record<string, any> = {};
				try { input = JSON.parse(block.inputJson || "{}"); } catch { /* ignore */ }

				const allowed = await this.checkPermission(block.name, input);
				let resultText: string;
				if (allowed) {
					const result = await this.registry.executeTool(block.name, input);
					resultText = result.success ? (result.result ?? "Done.") : `Error: ${result.error}`;
				} else {
					resultText = "Action denied by user.";
				}
				toolSummaries.push(resultText);
				toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
			}

			messages.push({ role: "assistant", content: assistantContent });
			messages.push({ role: "user", content: toolResults });
		}

		// If the model never produced any text (e.g. it only called tools and
		// stopped without a follow-up), synthesize a confirmation so the user
		// always sees a response rather than an empty bubble.
		if (fullText === "" && toolSummaries.length > 0) {
			fullText = AgentLoop.synthesizeConfirmation(toolSummaries);
			callbacks.onChunk(fullText);
		}

		return fullText;
	}

	// ---------------------------------------------------------------------------
	// OpenAI-compatible (OpenAI, Ollama, Mistral) — streaming
	// ---------------------------------------------------------------------------

	async runOpenAICompatible(
		params: ChatParams,
		client: OpenAI,
		callbacks: AgentCallbacks
	): Promise<string> {
		const tools = toOpenAITools(this.registry.getTools());

		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
			params.messages.map((m) => ({
				role: m.role as "user" | "assistant" | "system",
				content: m.content,
			}));

		callbacks.onStart();
		let fullText = "";
		let firstCall = true;
		const toolSummaries: string[] = [];

		while (true) {
			if (!firstCall) callbacks.onThinking();
			firstCall = false;

			// --- Streaming request ---
			const stream = await client.chat.completions.create({
				model: params.model,
				messages,
				tools,
				tool_choice: "auto",
				...(params.tokens ? { max_tokens: params.tokens } : {}),
				temperature: params.temperature,
				stream: true,
			});

			// Accumulate text and tool call deltas
			let textContent = "";
			// keyed by tool call index
			const toolCallsAcc: Record<
				number,
				{ id: string; name: string; arguments: string }
			> = {};
			let finishReason: string | null = null;

			for await (const chunk of stream) {
				const choice = chunk.choices[0];
				if (!choice) continue;

				// Text delta
				const textDelta = choice.delta?.content;
				if (textDelta) {
					textContent += textDelta;
					fullText += textDelta;
					callbacks.onChunk(textDelta);
				}

				// Tool call deltas
				const tcDeltas = choice.delta?.tool_calls;
				if (tcDeltas) {
					for (const tcd of tcDeltas) {
						const idx = tcd.index;
						if (!toolCallsAcc[idx]) {
							toolCallsAcc[idx] = { id: "", name: "", arguments: "" };
						}
						if (tcd.id) toolCallsAcc[idx].id = tcd.id;
						if (tcd.function?.name) toolCallsAcc[idx].name += tcd.function.name;
						if (tcd.function?.arguments) toolCallsAcc[idx].arguments += tcd.function.arguments;
					}
				}

				if (choice.finish_reason) finishReason = choice.finish_reason;
			}

			const toolCalls = Object.values(toolCallsAcc);
			if (finishReason !== "tool_calls" || toolCalls.length === 0) break;

			// Build the assistant message (required before tool result messages)
			const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
				role: "assistant",
				...(textContent ? { content: textContent } : { content: null }),
				tool_calls: toolCalls.map((tc) => ({
					id: tc.id,
					type: "function" as const,
					function: { name: tc.name, arguments: tc.arguments },
				})),
			};

			// Execute tool calls
			const toolResults: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = [];
			for (const tc of toolCalls) {
				let input: Record<string, any> = {};
				try { input = JSON.parse(tc.arguments); } catch { /* ignore */ }

				const allowed = await this.checkPermission(tc.name, input);
				let resultText: string;
				if (allowed) {
					const result = await this.registry.executeTool(tc.name, input);
					resultText = result.success ? (result.result ?? "Done.") : `Error: ${result.error}`;
				} else {
					resultText = "Action denied by user.";
				}
				toolSummaries.push(resultText);
				toolResults.push({ role: "tool", tool_call_id: tc.id, content: resultText });
			}

			messages.push(assistantMsg);
			messages.push(...toolResults);
		}

		// If the model never produced any text (e.g. it only called tools and
		// stopped without a follow-up), synthesize a confirmation so the user
		// always sees a response rather than an empty bubble.
		if (fullText === "" && toolSummaries.length > 0) {
			fullText = AgentLoop.synthesizeConfirmation(toolSummaries);
			callbacks.onChunk(fullText);
		}

		return fullText;
	}

	// ---------------------------------------------------------------------------
	// Helpers
	// ---------------------------------------------------------------------------

	/**
	 * Build a readable confirmation message from tool execution results.
	 * Used when a model calls tools but produces no text of its own.
	 */
	private static synthesizeConfirmation(summaries: string[]): string {
		if (summaries.length === 1) return `Done — ${summaries[0].toLowerCase()}.`;
		const lines = summaries.map((s) => `- ${s}`).join("\n");
		return `Done — here's what I did:\n${lines}`;
	}
}
