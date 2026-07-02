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
import { VaultIndexer } from "RAG/VaultIndexer";
import { ChatHistory } from "services/ChatHistory";
import { SearxngService } from "WebSearch/SearxngService";

/** Called by ChatContainer to render the approval card and await the user's choice. */
export type ShowPermissionUI = (
	toolName: string,
	toolDescription: string,
	input: Record<string, unknown>
) => Promise<boolean>;

export interface AgentCallbacks {
	/** Called once before the first API request — show thinking animation. */
	onStart: () => void;
	/** Called with each text chunk as it arrives from the model. */
	onChunk: (text: string) => void;
	/** Called between tool execution and the next API request — re-show thinking. */
	onThinking: () => void;
	/** Optional — called just before a tool executes so the UI can show which tool is running. */
	onToolStart?: (toolName: string, input: Record<string, unknown>) => void;
	/** Optional — called after each successful tool execution with the tool name, input, and result text. */
	onToolResult?: (toolName: string, input: Record<string, unknown>, result: string) => void;
	/** Optional — called with cumulative token counts after each model turn. */
	onUsage?: (inputTokens: number, outputTokens: number) => void;
}

export class AgentLoop {
	private registry: ObsidianToolRegistry;
	/**
	 * When set, only tools whose names appear in this list are exposed to the
	 * model. An empty array means "all tools allowed" (no restriction).
	 */
	private allowedTools: string[];
	/** Tools that are permanently disabled in Settings → Tools and never offered to the model. */
	private disabledTools: string[];
	/** Maximum tool-call/execute cycles per agent turn before the loop stops. */
	private maxToolCalls: number;

	constructor(
		private app: App,
		private permissionMode: PermissionMode,
		private showPermissionUI: ShowPermissionUI,
		vaultIndexer?: VaultIndexer | null,
		allowedTools?: string[],
		disabledTools?: string[],
		maxToolCalls?: number,
		/** Optional callback to configure the registry before the loop runs (e.g. register dynamic tools). */
		extraSetup?: (registry: ObsidianToolRegistry) => void,
		chatHistory?: ChatHistory,
		searxngService?: SearxngService | null,
	) {
		this.registry = new ObsidianToolRegistry(app, vaultIndexer ?? undefined, chatHistory, searxngService);
		extraSetup?.(this.registry);
		this.allowedTools = allowedTools ?? [];
		this.disabledTools = disabledTools ?? [];
		this.maxToolCalls = maxToolCalls ?? 10;
	}

	/** Return registry tools, filtered by allowedTools (skill restriction) and disabledTools (settings). */
	private getFilteredTools(): ReturnType<ObsidianToolRegistry["getTools"]> {
		const all = this.registry.getTools();
		return all.filter((t) => {
			if (this.disabledTools.includes(t.name)) return false;
			if (this.allowedTools.length > 0 && !this.allowedTools.includes(t.name)) return false;
			return true;
		});
	}

	// ---------------------------------------------------------------------------
	// Permission gate
	// ---------------------------------------------------------------------------

	private async checkPermission(
		toolName: string,
		input: Record<string, unknown>
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
		callbacks: AgentCallbacks,
		signal?: AbortSignal
	): Promise<string> {
		const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
		const tools = toAnthropicTools(this.getFilteredTools());

		type ClaudeMsg = { role: "user" | "assistant"; content: string | Anthropic.ContentBlockParam[] };
		const messages: ClaudeMsg[] = params.messages
			.filter((m) => m.role !== "system")
			.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

		callbacks.onStart();
		let fullText = "";
		let firstCall = true;
		const toolSummaries: string[] = [];
		let toolCallCount = 0;
		let totalInputTokens = 0;
		let totalOutputTokens = 0;

		while (true) {
			if (signal?.aborted) break;
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
				if (signal?.aborted) break;
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
					if (event.usage) {
						totalOutputTokens += event.usage.output_tokens ?? 0;
					}
				} else if (event.type === "message_start") {
					if (event.message?.usage) {
						totalInputTokens += event.message.usage.input_tokens ?? 0;
						totalOutputTokens += event.message.usage.output_tokens ?? 0;
					}
				}
			}

			callbacks.onUsage?.(totalInputTokens, totalOutputTokens);

			// Build typed content array for the assistant turn
			const assistantContent: Anthropic.ContentBlockParam[] = [];
			for (const block of blocks.values()) {
				if (block.type === "text") {
					assistantContent.push({ type: "text", text: block.text });
				} else {
					let input: Record<string, unknown> = {};
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
			if (toolCallCount >= this.maxToolCalls) {
				// Synthesize a stop notice so the user knows why the agent halted.
				if (fullText === "") {
					fullText = `Agent stopped after reaching the maximum of ${this.maxToolCalls} tool call(s). You can raise this limit in Settings → Tools.`;
					callbacks.onChunk(fullText);
				}
				break;
			}

			// Execute tool calls and collect results
			const toolResults: Anthropic.ToolResultBlockParam[] = [];
			for (const block of blocks.values()) {
				if (block.type !== "tool_use") continue;
				let input: Record<string, unknown> = {};
				try { input = JSON.parse(block.inputJson || "{}"); } catch { /* ignore */ }

				callbacks.onToolStart?.(block.name, input);
				let resultText: string;
				if (!this.registry.isToolAvailable(block.name)) {
					// Platform-unavailable tool (e.g. Node-backed on mobile): skip the
					// permission card and surface the registry's error to the model.
					const result = await this.registry.executeTool(block.name, input);
					resultText = `Error: ${result.error}`;
				} else if (await this.checkPermission(block.name, input)) {
					const result = await this.registry.executeTool(block.name, input);
					resultText = result.success ? (result.result ?? "Done.") : `Error: ${result.error}`;
					if (result.success) callbacks.onToolResult?.(block.name, input, resultText);
				} else {
					resultText = "Action denied by user.";
				}
				toolSummaries.push(resultText);
				toolResults.push({ type: "tool_result", tool_use_id: block.id, content: resultText });
			}

			messages.push({ role: "assistant", content: assistantContent });
			messages.push({ role: "user", content: toolResults });
			toolCallCount++;
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
		callbacks: AgentCallbacks,
		signal?: AbortSignal
	): Promise<string> {
		const tools = toOpenAITools(this.getFilteredTools());

		const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
			params.messages.map((m) => ({
				role: m.role,
				content: m.content,
			}));

		callbacks.onStart();
		let fullText = "";
		let firstCall = true;
		const toolSummaries: string[] = [];
		let toolCallCount = 0;

		while (true) {
			if (signal?.aborted) break;
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
				if (signal?.aborted) break;
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
			if (toolCallCount >= this.maxToolCalls) {
				if (fullText === "") {
					fullText = `Agent stopped after reaching the maximum of ${this.maxToolCalls} tool call(s). You can raise this limit in Settings → Tools.`;
					callbacks.onChunk(fullText);
				}
				break;
			}

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
				let input: Record<string, unknown> = {};
				try { input = JSON.parse(tc.arguments); } catch { /* ignore */ }

				let resultText: string;
				if (!this.registry.isToolAvailable(tc.name)) {
					// Platform-unavailable tool (e.g. Node-backed on mobile): skip the
					// permission card and surface the registry's error to the model.
					const result = await this.registry.executeTool(tc.name, input);
					resultText = `Error: ${result.error}`;
				} else if (await this.checkPermission(tc.name, input)) {
					const result = await this.registry.executeTool(tc.name, input);
					resultText = result.success ? (result.result ?? "Done.") : `Error: ${result.error}`;
					if (result.success) callbacks.onToolResult?.(tc.name, input, resultText);
				} else {
					resultText = "Action denied by user.";
				}
				toolSummaries.push(resultText);
				toolResults.push({ role: "tool", tool_call_id: tc.id, content: resultText });
			}

			messages.push(assistantMsg);
			messages.push(...toolResults);
			toolCallCount++;
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
