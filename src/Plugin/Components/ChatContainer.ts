import LLMPlugin from "main";
import {
	ButtonComponent,
	DropdownComponent,
	MarkdownRenderer,
	Notice,
	setIcon,
	TextAreaComponent,
} from "obsidian";
import { ChatCompletionChunk } from "openai/resources";
import { Stream } from "openai/streaming";
import { errorMessages } from "Plugin/Errors/errors";
import {
	ChatHistoryItem,
	ChatParams,
	HistoryItem,
	ImageHistoryItem,
	ImageParams,
	Message,
	ToolCallRecord,
	ViewType,
} from "Types/types";
import { classNames } from "utils/classNames";
import {
	assistant,
	chat,
	claude,
	claudeCode,
	claudeCodeEndpoint,
	gemini,
	gemini2FlashStableModel,
	gemini2FlashLiteModel,
	gemini25ProModel,
	gemini25FlashModel,
	gemini25FlashLiteModel,
	gemini3ProPreviewModel,
	geminiFlashLatestModel,
	geminiFlashLiteLatestModel,
	GPT4All,
	images,
	messages,
	ollama,
	lmStudio,
	mistral,
	openAI,
} from "utils/constants";

import assistantLogo from "Plugin/Components/AssistantLogo";
import { ConversationRegistry } from "./ConversationRegistry";
import {
	claudeCodeMessage,
	getGpt4AllPath,
	getSettingType,
	getViewInfo,
	messageGPT4AllServer,
	ollamaMessage,
	mistralMessage,
	claudeMessage,
	geminiMessage,
	openAIMessage,
	setHistoryIndex,
	setHistoryFilePath,
} from "utils/utils";
import { AgentLoop, AgentCallbacks } from "services/AgentLoop";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { models, modelNames } from "utils/models";
import { Header } from "./Header";
import { MessageStore } from "./MessageStore";
import { FileSelector } from "./FileSelector";
import defaultLogo from "assets/LLMgal.svg";
import zenKidLogo from "assets/zen-kid.svg";
import ninjaCatLogo from "assets/ninja-cat.svg";
import llmGuyLogo from "assets/llm-guy.svg";
import llmGalLogo from "assets/llm-gal.svg";
import { ContextBuilder } from "services/ContextBuilder";

const avatarSvgs: Record<string, string> = {
	"llm-gal": llmGalLogo,
	"llm-guy": llmGuyLogo,
	"zen-kid": zenKidLogo,
	"ninja-cat": ninjaCatLogo,
};

export class ChatContainer {
	historyMessages: HTMLElement;
	prompt: string;
	messages: Message[];
	replaceChatHistory: boolean;
	loadingDivContainer: HTMLElement;
	streamingDiv: HTMLElement;
	viewType: ViewType;
	previewText: string;
	messageStore: MessageStore;
	private registry: ConversationRegistry;
	// Stable bound reference so we can cleanly unsubscribe when switching stores.
	private boundUpdateMessages: (messages: Message[]) => void;
	contextBuilder: ContextBuilder;
	currentVaultContext: any = null; // Store context for current generation
	pendingContextString: string | null = null; // Context string to inject into API call (not shown in UI)
	claudeCodeSessionId: string | null = null;
	useActiveFileContext: boolean = false;
	/** When true (and RAG is enabled), embed the query and prepend top-k vault chunks before sending. */
	useVaultSearch: boolean = false;
	/** File paths retrieved by vault search for the current generation — cleared after appending sources panel. */
	private pendingRagSources: string[] = [];
	/** Tool calls accumulated during the current agent turn — committed to allToolCallsByTurn at turn end. */
	private pendingToolCalls: ToolCallRecord[] = [];
	/**
	 * Tool calls indexed by assistant-message turn (0-based).
	 * Entry i holds all tool calls made before the i-th assistant response.
	 * Cleared on newChat(). Populated by runAgentMode (live) or setToolCallsByTurn (from file load).
	 */
	allToolCallsByTurn: Map<number, ToolCallRecord[]> = new Map();

	/** Restore tool-call data when loading a conversation from a file. */
	setToolCallsByTurn(map: Map<number, ToolCallRecord[]>): void {
		this.allToolCallsByTurn = map;
	}
	/** Resolves when the most recent generateIMLikeMessages render is complete. */
	private renderingPromise: Promise<void> = Promise.resolve();
	/** Incremented each time a new render starts; stale renders compare against this and abort. */
	private renderGeneration = 0;
	/** Tracks the file path for the currently active chat file (file-based history only). Cleared on new chat. */
	currentHistoryFilePath: string | null = null;
	/** Optional callback set by the FAB header to sync the title display. */
	headerTitleCallback: ((title: string) => void) | null = null;
	chipContainer: HTMLElement | null = null;
	addFilesButton: ButtonComponent | null = null;
	scanButton: ButtonComponent | null = null;
	activeFileForChip: { name: string; path: string } | null = null;
	/** Stored so StatusBarButton (and FAB) can re-sync the displayed model after settings change. */
	private modelDropdown: DropdownComponent | null = null;

	constructor(
		private plugin: LLMPlugin,
		viewType: ViewType,
		registry: ConversationRegistry
	) {
		this.viewType = viewType;
		this.registry = registry;
		// Each view starts with its own fresh ephemeral store.
		// It gets promoted into the registry (under a UUID) the first time the
		// conversation is saved, and swapped for a registry store when the user
		// loads an existing conversation from history.
		this.messageStore = new MessageStore();
		this.boundUpdateMessages = this.updateMessages.bind(this);
		this.messageStore.subscribe(this.boundUpdateMessages);
		this.contextBuilder = new ContextBuilder(this.plugin.app);
	}

	/**
	 * Swap the active MessageStore for a different one, re-wiring the subscriber.
	 * Safe to call even if the new store is the same instance (no-op).
	 */
	private switchToStore(store: MessageStore): void {
		if (store === this.messageStore) return;
		this.messageStore.unsubscribe(this.boundUpdateMessages);
		this.messageStore = store;
		this.messageStore.subscribe(this.boundUpdateMessages);
	}

	/**
	 * Unsubscribe from the current store. Called when the view is closed so
	 * the store doesn't hold a stale reference to a torn-down DOM tree.
	 */
	destroy(): void {
		this.messageStore.unsubscribe(this.boundUpdateMessages);
	}

	private updateMessages(messages: Message[]) {
		// Each view has its own store, so the messages passed here are always
		// the right ones for this view — no cross-view filtering needed.
		this.resetChat();
		// Stamp a new generation so any in-flight render from a previous call
		// can detect it has been superseded and abort. Without this, stale async
		// renders continue appending DOM nodes after resetChat() has cleared the
		// container, causing duplicated or out-of-order messages.
		const gen = ++this.renderGeneration;
		// Store the promise so handleGenerateClick can await it before appending
		// the streaming/thinking div. Without this, setDiv() races with the async
		// message render and the thinking animation lands above the user message.
		this.renderingPromise = this.generateIMLikeMessages(messages, gen);
	}

	getMessages() {
		return this.messageStore.getMessages();
	}

	getParams(endpoint: string, model: string, modelType: string) {
		const settingType = getSettingType(this.viewType);
		const storedMessages = this.getMessages();

		// For OpenAI-compatible providers, inject context as a system message so it
		// stays separate from the user's message. Claude and Gemini handle system
		// context via their own dedicated parameters (set on the params object below).
		const isOpenAICompatible =
			modelType === ollama ||
			modelType === lmStudio ||
			modelType === mistral ||
			modelType === GPT4All ||
			endpoint === chat;

		const messagesForParams =
			this.pendingContextString && isOpenAICompatible
				? [{ role: "system" as const, content: this.pendingContextString }, ...storedMessages]
				: storedMessages;

		if (modelType === gemini) {
			const params: ChatParams = {
				// QUESTION -> Do we really want to send prompt when we are sending messages?
				prompt: this.prompt,
				// QUESTION -> how many messages do we really want to send?
				messages: messagesForParams,
				model,
				temperature:
					this.plugin.settings[settingType].chatSettings.temperature,
				tokens: this.plugin.settings[settingType].chatSettings
					.maxTokens,
				...(this.pendingContextString ? { systemContext: this.pendingContextString } : {}),
				...this.plugin.settings[settingType].chatSettings.gemini,
			};
			return params;
		}
		if (endpoint === images) {
			const params: ImageParams = {
				prompt: this.prompt,
				messages: messagesForParams,
				model,
				...this.plugin.settings[settingType].imageSettings,
			};
			return params;
		}

		if (endpoint === chat) {
			if (modelType === ollama || modelType === lmStudio || modelType === mistral || modelType === GPT4All) {
				const params: ChatParams = {
					prompt: this.prompt,
					messages: messagesForParams,
					model,
					temperature:
						this.plugin.settings[settingType].chatSettings
							.temperature,
					tokens: this.plugin.settings[settingType].chatSettings
						.maxTokens,
					...this.plugin.settings[settingType].chatSettings.GPT4All,
				};

				return params;
			}

			const params: ChatParams = {
				prompt: this.prompt,
				messages: messagesForParams,
				model,
				temperature:
					this.plugin.settings[settingType].chatSettings.temperature,
				tokens: this.plugin.settings[settingType].chatSettings
					.maxTokens,
				...this.plugin.settings[settingType].chatSettings.openAI,
			};
			return params;
		}
		// Handle claude
		if (endpoint === messages) {
			const params: ChatParams = {
				prompt: this.prompt,
				messages: messagesForParams,
				model,
				temperature:
					this.plugin.settings[settingType].chatSettings.temperature,
				tokens: this.plugin.settings[settingType].chatSettings
					.maxTokens,
				...(this.pendingContextString ? { systemContext: this.pendingContextString } : {}),
			};
			return params;
		}
	}

	async regenerateOutput() {
		const currentIndex = this.plugin.settings.currentIndex;
		if (currentIndex >= 0 && this.plugin.settings.promptHistory[currentIndex]) {
			const messages =
				this.plugin.settings.promptHistory[currentIndex].messages;
			this.messageStore.setMessages(messages);
		}
		this.removeLastMessageAndHistoryMessage();
		this.handleGenerate();
	}

	async handleGenerate(): Promise<boolean> {
		this.previewText = "";
		const {
			model,
			endpointURL,
			modelEndpoint,
			modelType,
			modelName,
		} = getViewInfo(this.plugin, this.viewType);
		let shouldHaveAPIKey = modelType !== GPT4All && modelType !== ollama && modelType !== lmStudio && modelType !== mistral && modelEndpoint !== claudeCodeEndpoint;
		const messagesForParams = this.getMessages();
		// TODO - fix this logic to actually do an API key check against the current view model.
		if (shouldHaveAPIKey) {
			const API_KEY =
				this.plugin.settings.openAIAPIKey ||
				this.plugin.settings.claudeAPIKey ||
				this.plugin.settings.geminiAPIKey;
			if (!API_KEY) {
				throw new Error("No API key");
			}
		}
		if (modelEndpoint === claudeCodeEndpoint) {
			if (!this.plugin.settings.claudeCodeOAuthToken) {
				throw new Error("No Claude Code OAuth token");
			}
		}
		const params = this.getParams(modelEndpoint, model, modelType);
		// Start Claude Code handling
		if (modelEndpoint === claudeCodeEndpoint) {
			this.setDiv(true);
			this.showThinkingAnimation();

			const vaultPath = (this.plugin.app.vault.adapter as any).basePath;
			const path = require("path");
			const pluginDir = path.join(vaultPath, this.plugin.manifest.dir);
			let stream;
			try {
				stream = await claudeCodeMessage(
					this.prompt,
					this.plugin.settings.claudeCodeOAuthToken,
					this.plugin.settings.linearWorkspaces,
					vaultPath,
					pluginDir,
					this.claudeCodeSessionId ?? undefined
				);
			} catch (err) {
				throw err;
			}

			try {
				let firstText = true;
				for await (const message of stream) {
					// Capture session ID from first message
					if (!this.claudeCodeSessionId && (message as any).session_id) {
						this.claudeCodeSessionId = (message as any).session_id;
					}
					if (message.type === "assistant") {
						for (const block of message.message.content) {
							if (block.type === "text" && block.text) {
								if (firstText) {
									this.streamingDiv.empty();
									firstText = false;
								}
								this.previewText += block.text;
								this.streamingDiv.textContent = this.previewText;
								this.historyMessages.scroll(0, 9999);
							}
						}
					}
				}
			} catch (err) {
				throw err;
			}

			this.streamingDiv.empty();
			await this.renderMarkdown(this.previewText, this.streamingDiv);
			this.messageStore.addMessage({
				role: assistant,
				content: this.previewText,
			});
			const message_context = {
				prompt: this.prompt,
				messages: this.getMessages(),
				model,
				temperature: 0,
				tokens: 0,
				modelName,
			} as ChatHistoryItem;
			this.historyPush(message_context, this.currentVaultContext);
			return true;
		}
		// End Claude Code handling

		// Check if the model is any Gemini model
		const isGeminiModel = [
			gemini2FlashStableModel,
			gemini2FlashLiteModel,
			gemini25ProModel,
			gemini25FlashModel,
			gemini25FlashLiteModel,
			gemini3ProPreviewModel,
			geminiFlashLatestModel,
			geminiFlashLiteLatestModel
		].includes(model);

		if (isGeminiModel) {
			this.setDiv(true);
			this.showThinkingAnimation();
			
			const stream = await geminiMessage(
				params as ChatParams,
				this.plugin.settings.geminiAPIKey
			);

			try {
				let firstChunk = true;
				for await (const chunk of stream) {
					const chunkText = chunk.text || "";
					if (firstChunk && chunkText) {
						this.streamingDiv.empty();
						firstChunk = false;
					}
					this.previewText += chunkText;
					if (!firstChunk) {
						this.streamingDiv.textContent = this.previewText;
						this.historyMessages.scroll(0, 9999);
					}
				}
			} catch (err) {
				console.error(err);
				return false;
			}

			this.streamingDiv.empty();
			await this.renderMarkdown(this.previewText, this.streamingDiv);
			this.messageStore.addMessage({
				role: assistant,
				content: this.previewText,
			});
			const message_context = {
				...(params as ChatParams),
				messages: this.getMessages(),
			} as ChatHistoryItem;
			this.historyPush(message_context, this.currentVaultContext);
			return true;
		}

		if (modelEndpoint === messages) {
			this.setDiv(true);
			this.showThinkingAnimation();
			
			const stream = await claudeMessage(
				params as ChatParams,
				this.plugin.settings.claudeAPIKey
			);

			let firstText = true;
			stream.on("text", (text) => {
				if (firstText && text) {
					this.streamingDiv.empty();
					firstText = false;
				}
				this.previewText += text || "";
				if (!firstText) {
					this.streamingDiv.textContent = this.previewText;
					this.historyMessages.scroll(0, 9999);
				}
			});

			// Wait for the stream to finish before post-processing.
			// Without this await, execution falls through immediately while text
			// events are still firing, so previewText is "" when
			// MarkdownRenderer.render and messageStore.addMessage are called.
			await stream.finalMessage();

			this.streamingDiv.empty();
			await this.renderMarkdown(this.previewText, this.streamingDiv);
			this.messageStore.addMessage({
				role: assistant,
				content: this.previewText,
			});
			const message_context = {
				...(params as ChatParams),
				messages: this.getMessages(),
			} as ChatHistoryItem;
			this.historyPush(message_context, this.currentVaultContext);
			return true;
		}
		// Ollama handling (local, OpenAI-compatible with streaming)
		if (modelType === ollama) {
			this.setDiv(true);
			this.showThinkingAnimation();

			const stream = await ollamaMessage(
				params as ChatParams,
				this.plugin.settings.ollamaHost
			);

			let firstChunk = true;
			for await (const chunk of stream as Stream<ChatCompletionChunk>) {
				const content = chunk.choices[0]?.delta?.content || "";
				if (firstChunk && content) {
					this.streamingDiv.empty();
					firstChunk = false;
				}
				this.previewText += content;
				if (!firstChunk) {
					this.streamingDiv.textContent = this.previewText;
					this.historyMessages.scroll(0, 9999);
				}
			}
			this.streamingDiv.empty();
			await this.renderMarkdown(this.previewText, this.streamingDiv);
			this.messageStore.addMessage({
				role: assistant,
				content: this.previewText,
			});
			const message_context = {
				...(params as ChatParams),
				messages: this.getMessages(),
				modelName,
			} as ChatHistoryItem;
			this.historyPush(message_context, this.currentVaultContext);
			return true;
		}

		// LM Studio handling (local, OpenAI-compatible with streaming)
		if (modelType === lmStudio) {
			this.setDiv(true);
			this.showThinkingAnimation();

			const lmStudioClient = new OpenAI({
				apiKey: "lm-studio",
				baseURL: `${this.plugin.settings.lmStudioHost}/v1`,
				dangerouslyAllowBrowser: true,
				timeout: 30000,
			});
			const { model, messages: msgList, tokens, temperature } = params as ChatParams;
			const stream = await lmStudioClient.chat.completions.create({
				model,
				messages: msgList,
				...(tokens ? { max_tokens: tokens } : {}),
				temperature,
				stream: true,
			});

			let firstChunk = true;
			for await (const chunk of stream as Stream<ChatCompletionChunk>) {
				const content = chunk.choices[0]?.delta?.content || "";
				if (firstChunk && content) {
					this.streamingDiv.empty();
					firstChunk = false;
				}
				this.previewText += content;
				if (!firstChunk) {
					this.streamingDiv.textContent = this.previewText;
					this.historyMessages.scroll(0, 9999);
				}
			}
			this.streamingDiv.empty();
			await this.renderMarkdown(this.previewText, this.streamingDiv);
			this.messageStore.addMessage({
				role: assistant,
				content: this.previewText,
			});
			const lmStudioContext = {
				...(params as ChatParams),
				messages: this.getMessages(),
				modelName,
			} as ChatHistoryItem;
			this.historyPush(lmStudioContext, this.currentVaultContext);
			return true;
		}

		// Mistral AI handling (OpenAI-compatible with streaming)
		if (modelType === mistral) {
			if (!this.plugin.settings.mistralAPIKey) {
				throw new Error("No Mistral API key");
			}
			this.setDiv(true);
			this.showThinkingAnimation();

			const stream = await mistralMessage(
				params as ChatParams,
				this.plugin.settings.mistralAPIKey
			);

			let firstChunk = true;
			for await (const chunk of stream as Stream<ChatCompletionChunk>) {
				const content = chunk.choices[0]?.delta?.content || "";
				if (firstChunk && content) {
					this.streamingDiv.empty();
					firstChunk = false;
				}
				this.previewText += content;
				if (!firstChunk) {
					this.streamingDiv.textContent = this.previewText;
					this.historyMessages.scroll(0, 9999);
				}
			}
			this.streamingDiv.empty();
			await this.renderMarkdown(this.previewText, this.streamingDiv);
			this.messageStore.addMessage({
				role: assistant,
				content: this.previewText,
			});
			const message_context = {
				...(params as ChatParams),
				messages: this.getMessages(),
				modelName,
			} as ChatHistoryItem;
			this.historyPush(message_context, this.currentVaultContext);
			return true;
		}

		// NOTE -> modelEndpoint === chat while modelType === GPT4All, so the ordering
		// of these two if statements is important.
		if (modelType === GPT4All) {
			this.plugin.settings.GPT4AllStreaming = true;
			this.setDiv(false);
			messageGPT4AllServer(params as ChatParams, endpointURL).then(
				(response: Message) => {
					this.streamingDiv.textContent = response.content;
					this.messageStore.addMessage(response);
					this.previewText = response.content;
					this.historyPush(params as ChatHistoryItem, this.currentVaultContext);
				}
			);
		} else if (modelEndpoint === chat) {
			const stream = await openAIMessage(
				params as ChatParams,
				this.plugin.settings.openAIAPIKey,
				endpointURL,
				modelEndpoint
			);
			this.setDiv(true);
			for await (const chunk of stream as Stream<ChatCompletionChunk>) {
				this.previewText += chunk.choices[0]?.delta?.content || "";
				this.streamingDiv.textContent = this.previewText;
				this.historyMessages.scroll(0, 9999);
			}
			this.streamingDiv.empty();
			await this.renderMarkdown(this.previewText, this.streamingDiv);
			this.messageStore.addMessage({
				role: assistant,
				content: this.previewText,
			});
			const message_context = {
				...(params as ChatParams),
				messages: this.messageStore.getMessages(),
			} as ChatHistoryItem;
			this.historyPush(message_context, this.currentVaultContext);
			return true;
		}
		return true;
	}

	async handleGenerateClick(header: Header, sendButton: ButtonComponent) {
		header.disableButtons();
		sendButton.setDisabled(true);
		const {
			model,
			modelName,
			modelType,
			endpointURL,
			modelEndpoint,
			historyIndex,
		} = getViewInfo(this.plugin, this.viewType);

		if (historyIndex > -1) {
			const messages =
				this.plugin.settings.promptHistory[historyIndex].messages;
			this.messageStore.setMessages(messages);
		}

		// The refresh button should only be displayed on the most recent
		// assistant message.
		const refreshButton = this.historyMessages.querySelector(
			".llm-refresh-output"
		);
		refreshButton?.remove();

		if (this.historyMessages.children.length < 1) {
			header.setHeader(modelName);
		}

		// Build and inject vault context (only if the feature is enabled)
		const settingType = getSettingType(this.viewType);
		const contextSettings = this.plugin.settings[settingType].contextSettings;
		const maxTokens = this.plugin.settings[settingType].chatSettings.maxTokens || 16384;
		const contextTokenBudget = this.contextBuilder.calculateContextTokenBudget(
			maxTokens,
			contextSettings.maxContextTokensPercent
		);

		let vaultContext = null;
		let contextString: string | null = null;

		// Build context when the global feature flag is on OR when the user has
		// explicitly added files via the + chip button (explicit intent always wins).
		const hasExplicitFileContext = (contextSettings.selectedFiles?.length ?? 0) > 0;
		if (modelEndpoint !== images && (this.plugin.settings.enableFileContext || hasExplicitFileContext)) {
			try {
				// useActiveFileContext is the single source of truth for whether the
				// active file is included. The saved setting controls the initial state
				// of useActiveFileContext, but the scan button can override it — so we
				// pass that flag here rather than the raw setting value.
				const effectiveContextSettings = {
					...contextSettings,
					includeActiveFile: this.useActiveFileContext,
				};
				contextString = await this.contextBuilder.buildFormattedContext(
					effectiveContextSettings,
					contextTokenBudget
				);
				if (contextString) {
					vaultContext = await this.contextBuilder.buildContext(effectiveContextSettings);
					// Store for use in historyPush
					this.currentVaultContext = vaultContext;
					// Store context string to be injected into API params (not rendered in UI)
					this.pendingContextString = contextString;
				}
			} catch (error) {
				console.error("Error building vault context:", error);
			}
		}

		// Vault search (RAG) fallback — for all models when the user has toggled "Search vault".
		// Agent-capable models also have the search_vault_semantic tool, so they can call it
		// autonomously; this block pre-fills context for models that may not call the tool,
		// or when the user explicitly wants vault context injected.
		if (
			this.useVaultSearch &&
			modelEndpoint !== images &&
			this.plugin.vaultIndexer &&
			this.plugin.settings.ragSettings.enabled
		) {
			try {
				const ragResults = await this.plugin.vaultIndexer.search(
					this.prompt,
					this.plugin.settings.ragSettings.topK
				);
				if (ragResults.length > 0) {
					// Deduplicate source paths while preserving rank order
					this.pendingRagSources = [...new Set(ragResults.map(r => r.filePath))];
					const ragContext = formatRagResultsAsContext(ragResults);
					this.pendingContextString = ragContext +
						(this.pendingContextString ? "\n\n---\n\n" + this.pendingContextString : "");
				}
			} catch (error) {
				console.error("[RAG] Vault search failed:", error);
				new Notice("Vault search failed — sending without vault context.");
			}
		}

		// Active file context toggle (explicit user action via scan button)
		if (this.useActiveFileContext && modelEndpoint !== images) {
			try {
				// Use the path locked when the user activated context, NOT the current
				// active file. This prevents switching documents mid-task from silently
				// swapping the context out from under the conversation.
				const lockedPath = this.activeFileForChip?.path;
				const contextFile = lockedPath
					? (this.plugin.app.vault.getAbstractFileByPath(lockedPath) as import("obsidian").TFile | null)
					: this.plugin.app.workspace.getActiveFile();
				if (contextFile) {
					const content = await this.plugin.app.vault.read(contextFile);
					const activeFileContextString =
						`# Active File: ${contextFile.name}\nPath: \`${contextFile.path}\`\n\n\`\`\`\n${content}\n\`\`\`\n`;
					// Override any previously built context string — explicit toggle wins
					this.pendingContextString = activeFileContextString;
					this.currentVaultContext = {
						activeFile: { path: contextFile.path, name: contextFile.name, content },
						additionalFiles: [],
					};
				}
			} catch (error) {
				console.error("Error reading active file for context:", error);
			}
		}

		// For agent mode: prepend a hint that identifies the active/context file(s)
		// so the model knows which file to act on when the user says "this page", etc.
		// Only inject when the user has active-file context enabled — otherwise agent
		// models will autonomously read the file even though the user turned it off.
		if (this.supportsAgentMode(modelType) && modelEndpoint !== images && this.useActiveFileContext) {
			const activeFile = this.plugin.app.workspace.getActiveFile();
			if (activeFile || this.pendingContextString) {
				const activeHint = activeFile
					? `The user's currently active note is "${activeFile.name}" at vault path "${activeFile.path}". When the user refers to "this page", "this note", "this file", or similar, they mean this file.\n\n`
					: "";
				if (activeHint && this.pendingContextString) {
					this.pendingContextString = activeHint + this.pendingContextString;
				} else if (activeHint && !this.pendingContextString) {
					this.pendingContextString = activeHint;
				}
			}
		}

		const userMessage = { role: "user" as const, content: this.prompt };
		this.messageStore.addMessage(userMessage);
		// Wait for the async DOM render triggered by addMessage to complete before
		// calling setDiv/showThinkingAnimation — otherwise the thinking animation
		// is appended before the user message and appears at the top of the chat.
		await this.renderingPromise;
		const params = this.getParams(modelEndpoint, model, modelType);
		try {
			this.previewText = "";
			if (modelEndpoint !== images) {
				if (this.supportsAgentMode(modelType)) {
					await this.runAgentMode(
						params as ChatParams,
						model,
						modelType,
						modelName
					);
				} else {
					await this.handleGenerate();
				}
				// Append cited sources panel if vault search was used
				if (this.pendingRagSources.length > 0) {
					this.appendSourcesPanel(this.loadingDivContainer, this.pendingRagSources);
					this.pendingRagSources = [];
				}
				// Clear context after generation
				this.currentVaultContext = null;
				this.pendingContextString = null;
			}
			if (modelEndpoint === images) {
				this.setDiv(false);
				await openAIMessage(
					params as ImageParams,
					this.plugin.settings.openAIAPIKey,
					endpointURL,
					modelEndpoint
				).then((response: string[]) => {
					this.streamingDiv.empty();
					let content = "";
					response.map((url) => {
						if (!url.startsWith("data:")) {
							content += `![created with prompt ${this.prompt}](${url})`;
						}
					});
					if (!content) {
						content = `[Image generated with prompt: ${this.prompt}]`;
					}
					this.messageStore.addMessage({
						role: assistant,
						content,
					});
					this.appendImage(response);
					this.historyPush(
						{
							...params,
							messages: this.getMessages(),
						} as ImageHistoryItem,
						this.currentVaultContext
					);
				});
			}
			header.enableButtons();
			sendButton.setDisabled(false);
			const buttonsContainer = this.loadingDivContainer.querySelector(
				".llm-assistant-buttons"
			);
			buttonsContainer?.removeClass("llm-hide");
		} catch (error) {
			header.enableButtons();
			sendButton.setDisabled(false);
			this.plugin.settings.GPT4AllStreaming = false;
			this.prompt = "";
			this.pendingRagSources = [];
			errorMessages(error, params);
			if (this.getMessages().length > 0) {
				setTimeout(() => {
					this.removeMessage(header, modelName);
				}, 1000);
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Agent mode helpers
	// ---------------------------------------------------------------------------

	/** Returns true for providers that support native tool calling. */
	private supportsAgentMode(modelType: string): boolean {
		return (
			modelType === claude ||
			modelType === ollama ||
			modelType === lmStudio ||
			modelType === mistral ||
			modelType === openAI
		);
	}

	/** Build the right OpenAI-compatible client for a given provider. */
	private createOpenAIClient(modelType: string): OpenAI {
		if (modelType === ollama) {
			return new OpenAI({
				apiKey: "ollama",
				baseURL: `${this.plugin.settings.ollamaHost}/v1`,
				dangerouslyAllowBrowser: true,
				timeout: 30000,
			});
		}
		if (modelType === lmStudio) {
			return new OpenAI({
				apiKey: "lm-studio",
				baseURL: `${this.plugin.settings.lmStudioHost}/v1`,
				dangerouslyAllowBrowser: true,
				timeout: 30000,
			});
		}
		if (modelType === mistral) {
			return new OpenAI({
				apiKey: this.plugin.settings.mistralAPIKey,
				baseURL: "https://api.mistral.ai/v1",
				dangerouslyAllowBrowser: true,
			});
		}
		// openAI
		return new OpenAI({
			apiKey: this.plugin.settings.openAIAPIKey,
			dangerouslyAllowBrowser: true,
		});
	}

	/**
	 * Render an inline approval card in the chat history and return a Promise
	 * that resolves to true (Allow) or false (Deny) when the user clicks.
	 */
	private showPermissionUI(
		toolName: string,
		toolDescription: string,
		input: Record<string, any>
	): Promise<boolean> {
		return new Promise((resolve) => {
			const card = this.historyMessages.createDiv({ cls: "llm-permission-card" });

			// Header row
			const cardHeader = card.createDiv({ cls: "llm-permission-header" });
			const iconEl = cardHeader.createEl("span", { cls: "llm-permission-icon" });
			setIcon(iconEl, "wand-sparkles");
			cardHeader.createEl("span", {
				text: "Agent wants to perform an action",
				cls: "llm-permission-title",
			});

			// Body
			const body = card.createDiv({ cls: "llm-permission-body" });
			body.createEl("div", {
				text: toolDescription,
				cls: "llm-permission-description",
			});
			const inputEl = body.createEl("pre", { cls: "llm-permission-input" });
			inputEl.textContent = JSON.stringify(input, null, 2);

			// Buttons
			const btnRow = card.createDiv({ cls: "llm-permission-buttons" });

			const denyBtn = new ButtonComponent(btnRow);
			denyBtn.setButtonText("Deny");
			denyBtn.buttonEl.addClass("llm-permission-deny");

			const allowBtn = new ButtonComponent(btnRow);
			allowBtn.setButtonText("Allow");
			allowBtn.buttonEl.addClass("llm-permission-allow", "mod-cta");

			const cleanup = (e: MouseEvent, result: boolean) => {
				// Stop propagation BEFORE removing the card. If we remove the card
				// first, the button element is detached from the DOM mid-bubble.
				// Obsidian's global click handler then sees event.target is no
				// longer in the document and interprets it as a click-outside,
				// closing the FAB/popover. Stopping here prevents that entirely.
				e.stopPropagation();
				card.remove();
				resolve(result);
			};

			denyBtn.onClick((e) => cleanup(e, false));
			allowBtn.onClick((e) => cleanup(e, true));

			this.historyMessages.scroll(0, 9999);
		});
	}

	/**
	 * Run the agentic loop for the current prompt, handling tool calls and
	 * permission prompts, then commit the final response to the message store.
	 */
	private async runAgentMode(
		params: ChatParams,
		model: string,
		modelType: string,
		modelName: string
	): Promise<void> {
		const settingType = getSettingType(this.viewType);
		const permissionMode =
			this.plugin.settings[settingType].agentSettings?.permissionMode ?? "ask";

		// Capture the current assistant-message count to use as the turn index.
		// Tool calls accumulated this turn will be associated with this index.
		const turnIndex = this.getMessages().filter((m) => m.role === assistant).length;
		this.pendingToolCalls = [];

		const agentLoop = new AgentLoop(
			this.plugin.app,
			permissionMode,
			this.showPermissionUI.bind(this),
			this.plugin.vaultIndexer,
		);

		const callbacks: AgentCallbacks = {
			onStart: () => {
				this.setDiv(true);
				this.showThinkingAnimation();
			},
			onChunk: (text) => {
				// First chunk: clear the thinking animation
				if (this.previewText === "" && text) {
					this.streamingDiv.empty();
				}
				this.previewText += text;
				this.streamingDiv.textContent = this.previewText;
				this.historyMessages.scroll(0, 9999);
			},
			onThinking: () => {
				// Between tool turns: show thinking animation again; the next
				// onChunk will replace streamingDiv content with accumulated text.
				this.showThinkingAnimation();
			},
			onToolResult: (toolName, input, result) => {
				// Track for RAG sources panel
				if (toolName === "search_vault_semantic") {
					// Extract ### file/path.md headers from the formatted result block
					const paths = extractRagSourcePaths(result);
					for (const p of paths) {
						if (!this.pendingRagSources.includes(p)) this.pendingRagSources.push(p);
					}
				} else if (toolName === "obsidian_read_note" && typeof input.path === "string") {
					// The model explicitly read a note — that note is a source
					if (!this.pendingRagSources.includes(input.path)) {
						this.pendingRagSources.push(input.path);
					}
				}
				// Record the tool call for chat file history
				this.pendingToolCalls.push({ name: toolName, input, result });
			},
		};

		if (modelType === claude) {
			await agentLoop.runAnthropic(
				params,
				this.plugin.settings.claudeAPIKey,
				callbacks
			);
		} else {
			const client = this.createOpenAIClient(modelType);
			await agentLoop.runOpenAICompatible(params, client, callbacks);
		}

		// Render final markdown
		this.streamingDiv.empty();
		await this.renderMarkdown(this.previewText, this.streamingDiv);

		this.messageStore.addMessage({ role: assistant, content: this.previewText });

		// Commit tool calls for this turn before saving to history
		if (this.pendingToolCalls.length > 0) {
			this.allToolCallsByTurn.set(turnIndex, [...this.pendingToolCalls]);
			this.pendingToolCalls = [];
		}

		const messageContext = {
			...(params as ChatParams),
			messages: this.getMessages(),
			modelName,
		} as ChatHistoryItem;
		this.historyPush(messageContext, this.currentVaultContext);
	}

	historyPush(params: HistoryItem, vaultContext?: any) {
		const { modelName, historyIndex, historyFilePath, modelEndpoint } =
			getViewInfo(this.plugin, this.viewType);

		// ── File-based path (chatHistoryEnabled, chat only) ───────────────────
		if (
			this.plugin.settings.chatHistoryEnabled &&
			modelEndpoint !== images
		) {
			this.historyPushToFile(
				params as ChatHistoryItem,
				vaultContext,
				historyFilePath
			).catch((e) =>
				console.error("[ChatContainer] Failed to save chat file:", e)
			);
			return;
		}

		// ── Legacy array-based path ───────────────────────────────────────────
		if (historyIndex > -1) {
			this.plugin.history.overwriteHistory(
				this.getMessages(),
				historyIndex
			);
			return;
		}

		// This is a brand-new conversation. Assign a stable UUID so other views
		// can look up the same MessageStore in the registry later.
		const conversationId = crypto.randomUUID();
		this.registry.set(conversationId, this.messageStore);

		// Update the FAB header title with the first user message.
		if (this.headerTitleCallback) {
			const firstUserMessage = this.getMessages().find((m) => m.role === "user");
			if (firstUserMessage) {
				this.headerTitleCallback(firstUserMessage.content);
			}
		}

		if (
			modelEndpoint === chat ||
			modelEndpoint === gemini ||
			modelEndpoint === messages ||
			modelEndpoint === claudeCodeEndpoint
		) {
			const chatParams = params as ChatHistoryItem;
			// Add vault context to history if it exists
			if (vaultContext) {
				chatParams.vaultContext = vaultContext;
			}
			this.plugin.history.push({
				...chatParams,
				modelName,
				id: conversationId,
			});
		}
		if (modelEndpoint === images) {
			this.plugin.history.push({
				...(params as ImageHistoryItem),
				modelName,
				id: conversationId,
			});
		}
		const length = this.plugin.settings.promptHistory.length;
		setHistoryIndex(this.plugin, this.viewType, length);
		this.plugin.saveSettings();
		this.prompt = "";
	}

	/** File-based save path — called when chatHistoryEnabled is true. */
	private async historyPushToFile(
		params: ChatHistoryItem,
		vaultContext: any,
		_historyFilePath: string | null  // kept for signature compatibility; instance var used instead
	): Promise<void> {
		const messages = this.getMessages();

		if (this.currentHistoryFilePath) {
			// ── Update existing file ──────────────────────────────────────
			await this.plugin.chatHistory.save(
				this.currentHistoryFilePath,
				"", // title unused on update
				messages,
				params,
				vaultContext,
				this.allToolCallsByTurn.size > 0 ? this.allToolCallsByTurn : undefined
			);
			return;
		}

		// ── New conversation ──────────────────────────────────────────────
		const conversationId = crypto.randomUUID();
		this.registry.set(conversationId, this.messageStore);

		// Show the first user message in the header immediately while the
		// title is being generated in the background.
		if (this.headerTitleCallback) {
			const firstUser = messages.find((m) => m.role === "user");
			if (firstUser) this.headerTitleCallback(firstUser.content);
		}

		// Generate a short title, falling back to word-truncation on failure.
		const title = await this.plugin.chatHistory.generateTitle(
			messages,
			() => this.generateConversationTitle(messages, params)
		);

		// Update header with the real generated title.
		if (this.headerTitleCallback) {
			this.headerTitleCallback(title);
		}

		const filePath = await this.plugin.chatHistory.save(
			null,
			title,
			messages,
			params,
			vaultContext,
			this.allToolCallsByTurn.size > 0 ? this.allToolCallsByTurn : undefined
		);

		this.currentHistoryFilePath = filePath;
		setHistoryFilePath(this.plugin, this.viewType, filePath);
		this.prompt = "";
	}

	/**
	 * Ask the active provider to produce a short conversation title.
	 * Throws on failure so ChatHistory.generateTitle can fall back.
	 */
	private async generateConversationTitle(
		messages: Message[],
		params: ChatHistoryItem
	): Promise<string> {
		const { model, modelType } = getViewInfo(this.plugin, this.viewType);

		const titleRequest: Array<{ role: "user" | "assistant"; content: string }> =
			[
				...messages
					.filter((m) => m.role !== "system")
					.slice(0, 4)
					.map((m) => ({
						role: m.role as "user" | "assistant",
						content: m.content,
					})),
				{
					role: "user" as const,
					content:
						"Generate a very short title for this conversation in 5 words or fewer. Output only the title — no punctuation, no quotes, no explanation.",
				},
			];

		// ── OpenAI / Mistral / Ollama / LM Studio (all OpenAI-compatible) ───
		if (
			modelType === openAI ||
			modelType === mistral ||
			modelType === ollama ||
			modelType === lmStudio
		) {
			const apiKey =
				modelType === openAI
					? this.plugin.settings.openAIAPIKey
					: modelType === mistral
					? this.plugin.settings.mistralAPIKey
					: modelType === lmStudio
					? "lm-studio"
					: "ollama";
			const baseURL =
				modelType === mistral
					? "https://api.mistral.ai/v1"
					: modelType === ollama
					? `${this.plugin.settings.ollamaHost}/v1`
					: modelType === lmStudio
					? `${this.plugin.settings.lmStudioHost}/v1`
					: undefined;

			const client = new OpenAI({
				apiKey,
				baseURL,
				dangerouslyAllowBrowser: true,
			});
			const resp = await client.chat.completions.create({
				model,
				messages: titleRequest,
				max_tokens: 20,
				temperature: 0.3,
			});
			return resp.choices[0]?.message?.content?.trim() ?? "";
		}

		// ── Claude ────────────────────────────────────────────────────────
		if (modelType === claude) {
			const client = new Anthropic({
				apiKey: this.plugin.settings.claudeAPIKey,
				dangerouslyAllowBrowser: true,
			});
			const resp = await client.messages.create({
				model,
				max_tokens: 20,
				messages: titleRequest,
			});
			const block = resp.content[0];
			return block.type === "text" ? block.text.trim() : "";
		}

		// ── Gemini ────────────────────────────────────────────────────────
		if (modelType === gemini) {
			const client = new GoogleGenAI({
				apiKey: this.plugin.settings.geminiAPIKey,
			});
			const contents = titleRequest.map((m) => ({
				role: m.role === "user" ? "user" : "model",
				parts: [{ text: m.content }],
			}));
			const resp = await client.models.generateContent({ model, contents });
			return resp.text?.trim() ?? "";
		}

		// GPT4All — not worth a separate HTTP call; let the fallback handle it.
		throw new Error(`Title generation not supported for provider: ${modelType}`);
	}

	auto_height(elem: TextAreaComponent, parentElement: Element) {
		const MAX_HEIGHT = 140; // ~5 lines before scrolling
		// Collapse to 1px so scrollHeight accurately reflects content height
		elem.inputEl.setAttribute("style", "height: 1px");
		const contentHeight = elem.inputEl.scrollHeight;
		if (contentHeight <= MAX_HEIGHT) {
			elem.inputEl.setAttribute("style", `height: ${contentHeight}px; overflow-y: hidden`);
		} else {
			elem.inputEl.setAttribute("style", `height: ${MAX_HEIGHT}px; overflow-y: auto`);
		}
		parentElement.scrollTo(0, 9999);
	}

	displayNoChatView(parentElement: Element) {
		parentElement.addClass("llm-justify-content-center");
		parentElement.addClass("center-llmgal");

		const llmGal = parentElement.createDiv();
		llmGal.addClass("llm-icon-wrapper");
		llmGal.addClass("llm-icon-new-chat");

		const selectedAvatar = this.plugin.settings.emptyChatAvatar || "llm-gal";
		const svgString = avatarSvgs[selectedAvatar] || defaultLogo;
		const parser = new DOMParser();
		const svgDoc = parser.parseFromString(svgString, "image/svg+xml");
		const svgElement = svgDoc.documentElement;

		llmGal.appendChild(svgElement);
	}

	/** Rebuild the chip strip from current state (active file + additional files). */
	syncChips() {
		if (!this.chipContainer) return;
		const settingType = getSettingType(this.viewType);
		const contextSettings = this.plugin.settings[settingType].contextSettings;

		this.chipContainer.empty();

		// When file context is disabled, show nothing
		if (!this.plugin.settings.enableFileContext) {
			this.chipContainer.style.display = "none";
			return;
		}

		const hasActiveFile = this.useActiveFileContext && this.activeFileForChip;
		const hasAdditional = contextSettings.selectedFiles.length > 0;

		if (!hasActiveFile && !hasAdditional) {
			this.chipContainer.style.display = "none";
			return;
		}

		this.chipContainer.style.display = "flex";

		if (hasActiveFile) {
			this.buildChip(this.chipContainer, this.activeFileForChip!.name, () => {
				this.useActiveFileContext = false;
				this.activeFileForChip = null;
				this.scanButton?.buttonEl.removeClass("is-active");
				this.syncChips();
			});
		}

		for (const filePath of [...contextSettings.selectedFiles]) {
			const fileName = filePath.split("/").pop() || filePath;
			this.buildChip(this.chipContainer, fileName, () => {
				contextSettings.selectedFiles = contextSettings.selectedFiles.filter(
					(f) => f !== filePath
				);
				this.plugin.saveSettings();
				this.syncChips();
			});
		}
	}

	private buildChip(
		container: HTMLElement,
		name: string,
		onRemove: () => void
	): HTMLElement {
		const chip = container.createDiv({ cls: "llm-context-chip" });
		const fileIcon = chip.createEl("span", { cls: "llm-context-chip-icon" });
		setIcon(fileIcon, "file-text");
		chip.createEl("span", { text: name, cls: "llm-context-chip-name" });
		const removeBtn = chip.createEl("span", {
			text: "×",
			cls: "llm-context-chip-remove",
		});
		removeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			onRemove();
		});
		return chip;
	}

	async generateChatContainer(parentElement: Element, header: Header) {
		// If we are working with assistants, then we need a valid openAi API key.
		// If we are working with claude, then we need a valid claude key.
		// If we are working with a local model, then we only need to be able to perform a health check against
		// that model.
		this.messageStore.setMessages([]);
		this.historyMessages = parentElement.createDiv();
		this.historyMessages.className =
			classNames[this.viewType]["messages-div"];
		if (this.getMessages().length === 0) {
			this.displayNoChatView(this.historyMessages);
		}

		// Outer prompt container — a flex-column card with border
		const promptContainer = parentElement.createDiv();
		promptContainer.addClass(classNames[this.viewType]["prompt-container"]);

		// Chip strip — shown for all view types; scan button only for FAB/Modal
		this.chipContainer = promptContainer.createDiv();
		this.chipContainer.addClass("llm-context-chip-container");
		this.chipContainer.style.display = "none";

		// Top section: textarea
		const inputSection = promptContainer.createDiv();
		inputSection.addClass("llm-input-section");
		const promptField = new TextAreaComponent(inputSection);
		promptField.inputEl.className = classNames[this.viewType]["text-area"];
		promptField.inputEl.id = "chat-prompt-text-area";
		promptField.inputEl.tabIndex = 0;
		promptContainer.addEventListener("input", () => {
			this.auto_height(promptField, parentElement);
		});

		// Bottom toolbar: model selector (left) + send button (right)
		const toolbarSection = promptContainer.createDiv();
		toolbarSection.addClass("llm-input-toolbar");

		// Model dropdown
		const settingType = getSettingType(this.viewType);
		const viewSettings = this.plugin.settings[settingType];
		this.modelDropdown = new DropdownComponent(toolbarSection);
		const modelDropdown = this.modelDropdown;
		modelDropdown.selectEl.addClass("llm-model-select");
		const { openAIAPIKey, claudeAPIKey, geminiAPIKey, mistralAPIKey } = this.plugin.settings;
		for (const modelDisplayName of Object.keys(models)) {
			const type = models[modelDisplayName].type;
			// Local providers: always show
			if (type === ollama || type === lmStudio) {
				modelDropdown.addOption(models[modelDisplayName].model, modelDisplayName);
				continue;
			}
			// GPT4All: only show if the model file exists locally
			if (type === GPT4All) {
				const gpt4AllPath = getGpt4AllPath(this.plugin);
				const fullPath = `${gpt4AllPath}/${models[modelDisplayName].model}`;
				if (this.plugin.fileSystem.existsSync(fullPath)) {
					modelDropdown.addOption(models[modelDisplayName].model, modelDisplayName);
				}
				continue;
			}
			// Cloud providers: only show if an API key has been entered
			if (type === openAI && !openAIAPIKey) continue;
			if ((type === claude || type === claudeCode) && !claudeAPIKey) continue;
			if (type === gemini && !geminiAPIKey) continue;
			if (type === mistral && !mistralAPIKey) continue;
			modelDropdown.addOption(models[modelDisplayName].model, modelDisplayName);
		}
		modelDropdown.setValue(viewSettings.model);
		modelDropdown.onChange((change) => {
			const modelName = modelNames[change];
			if (!modelName || !models[modelName]) return;
			viewSettings.model = change;
			viewSettings.modelName = modelName;
			viewSettings.modelType = models[modelName].type;
			viewSettings.endpointURL = models[modelName].url;
			viewSettings.modelEndpoint = models[modelName].endpoint;
			this.plugin.saveSettings();
			header.setHeader(modelName);
		});

		// Right-side group: scan button (FAB/Modal only) + send button
		const toolbarRight = toolbarSection.createDiv();
		toolbarRight.addClass("llm-input-toolbar-right");

		// Add files / file-picker button
		this.addFilesButton = new ButtonComponent(toolbarRight);
		const addFilesButton = this.addFilesButton;
		addFilesButton.setIcon("plus");
		addFilesButton.setTooltip("Add files as context");
		addFilesButton.buttonEl.addClass("llm-scan-button");

		addFilesButton.onClick(() => {
			const settingType = getSettingType(this.viewType);
			const contextSettings = this.plugin.settings[settingType].contextSettings;

			new FileSelector(
				this.plugin.app,
				this.plugin,
				this.viewType,
				contextSettings.selectedFiles,
				(files: string[]) => {
					contextSettings.selectedFiles = files;
					this.plugin.saveSettings();
					this.syncChips();
				}
			).open();
		});

		// Scan / use-file-as-context button (FAB and Modal only — not widget)
		if (this.viewType !== "widget") {
			this.scanButton = new ButtonComponent(toolbarRight);
			this.scanButton.setIcon("scan");
			this.scanButton.setTooltip("Use file as context");
			this.scanButton.buttonEl.addClass("llm-scan-button");

			this.scanButton.onClick(() => {
				this.useActiveFileContext = !this.useActiveFileContext;

				if (this.useActiveFileContext) {
					const activeFile = this.plugin.app.workspace.getActiveFile();
					if (activeFile) {
						this.activeFileForChip = { name: activeFile.name, path: activeFile.path };
						this.scanButton!.buttonEl.addClass("is-active");
						this.syncChips();
					} else {
						this.useActiveFileContext = false;
						new Notice("No active file to use as context");
					}
				} else {
					this.activeFileForChip = null;
					this.scanButton!.buttonEl.removeClass("is-active");
					this.syncChips();
				}
			});
		}

		// Vault search toggle button — only shown when RAG is enabled AND the current
		// model doesn't support agent tool-calling (agent models get the tool automatically).
		if (this.plugin.settings.ragSettings?.enabled && this.plugin.vaultIndexer) {
			const vaultSearchButton = new ButtonComponent(toolbarRight);
			vaultSearchButton.setIcon("search");
			vaultSearchButton.setTooltip("Search vault");
			vaultSearchButton.buttonEl.addClass("llm-scan-button");

			// Hide/show based on whether the selected model supports agent mode
			const syncVaultSearchVisibility = (modelType: string) => {
				const hidden = this.supportsAgentMode(modelType);
				vaultSearchButton.buttonEl.toggleClass("llm-hidden", hidden);
				// If we just hid it, also deactivate the toggle so it doesn't
				// silently inject context on the next send
				if (hidden) {
					this.useVaultSearch = false;
					vaultSearchButton.buttonEl.removeClass("is-active");
				}
			};

			// Set initial visibility from the currently selected model
			syncVaultSearchVisibility(viewSettings.modelType);

			vaultSearchButton.onClick(() => {
				this.useVaultSearch = !this.useVaultSearch;
				vaultSearchButton.buttonEl.toggleClass("is-active", this.useVaultSearch);
			});

			// Re-evaluate whenever the user switches models
			modelDropdown.onChange((change) => {
				const modelName = modelNames[change];
				if (modelName && models[modelName]) {
					syncVaultSearchVisibility(models[modelName].type);
				}
			});
		}

		// Sync file-context button visibility based on the current setting
		this.syncFileContextButtons();

		// Send button
		const sendButton = new ButtonComponent(toolbarRight);
		sendButton.buttonEl.addClass(
			classNames[this.viewType].button,
			"llm-send-button"
		);
		sendButton.setIcon("up-arrow-with-tail");
		sendButton.setTooltip("Send prompt");

		promptField.setPlaceholder("Send a message...");

		// Helper to sync send button enabled/disabled state with input content
		const updateSendButton = (value: string) => {
			const isEmpty = value.trim().length === 0;
			sendButton.setDisabled(isEmpty);
			sendButton.buttonEl.toggleClass("llm-send-button-disabled", isEmpty);
		};

		// Disable send button initially (empty input)
		updateSendButton("");

		promptField.onChange((change: string) => {
			this.prompt = change;
			promptField.setValue(change);
			updateSendButton(change);
		});

		const clearPromptField = () => {
			// Only clear the visible textarea; this.prompt intentionally stays
			// set so that handleGenerateClick (which is not awaited) can still
			// read it after clearPromptField fires. historyPush (success) and
			// the catch block (error) both clear this.prompt when the call ends.
			promptField.setValue("");
			updateSendButton("");
		};

		promptField.inputEl.addEventListener("keydown", (event) => {
			if (sendButton.disabled === true) return;

			if (event.code == "Enter") {
				event.preventDefault();
				this.handleGenerateClick(header, sendButton);
				clearPromptField();
			}
		});
		sendButton.onClick(() => {
			this.handleGenerateClick(header, sendButton);
			clearPromptField();
		});

		// Auto-populate the active file chip when "Include active file" is enabled in settings.
		// useActiveFileContext is otherwise only set when the scan button is clicked manually,
		// so without this block the chip never appears on load even when the setting is on.
		if (this.plugin.settings[settingType].contextSettings.includeActiveFile) {
			const activeFile = this.plugin.app.workspace.getActiveFile();
			if (activeFile) {
				this.useActiveFileContext = true;
				this.activeFileForChip = { name: activeFile.name, path: activeFile.path };
				this.scanButton?.buttonEl.addClass("is-active");
			}
		}

		// Restore any chips that were persisted in settings before this session
		this.syncChips();
	}

	setMessages(replaceChatHistory: boolean = false) {
		const { historyIndex } = getViewInfo(this.plugin, this.viewType);
		if (replaceChatHistory) {
			const history = this.plugin.settings.promptHistory;
			const historyItem = history[historyIndex];
			// Backfill: legacy history items (saved before this change) have no id.
			// Assign one now so every subsequent load — including from other views —
			// will find the same registry store and stay in sync.
			if (!historyItem.id) {
				historyItem.id = crypto.randomUUID();
				this.plugin.saveSettings();
			}

			// Get or create the store for this conversation in the registry.
			// If another view already has it open they share the same instance
			// and will stay in sync automatically.
			const store = this.registry.getOrCreate(historyItem.id);
			if (store.getMessages().length === 0) {
				// First view to open this conversation — populate from disk.
				store.setMessages(historyItem.messages);
			}
			this.switchToStore(store);
		}
		if (!replaceChatHistory) {
			this.messageStore.addMessage({
				role: "user",
				content: this.prompt,
			});
		}
	}

	resetMessages() {
		// Switch to a fresh ephemeral store so the old conversation's store
		// (which may still be open in another view) is left untouched.
		const freshStore = new MessageStore();
		this.switchToStore(freshStore);
		this.claudeCodeSessionId = null;
		// Clear the active chat file so the next conversation creates a new file.
		this.currentHistoryFilePath = null;
		if (this.plugin.settings.chatHistoryEnabled) {
			setHistoryFilePath(this.plugin, this.viewType, null);
		}
	}

	setDiv(streaming: boolean) {
		const parent = this.historyMessages.createDiv();
		parent.addClass("llm-flex");
		const assistant = parent.createEl("div", { cls: "llm-assistant-logo" });
		assistant.appendChild(assistantLogo());

		this.loadingDivContainer = parent.createDiv();
		this.streamingDiv = this.loadingDivContainer.createDiv();

		const buttonsContainer = this.loadingDivContainer.createEl("div", {
			cls: "llm-assistant-buttons llm-hide",
		});
		const copyToClipboardButton = new ButtonComponent(buttonsContainer);
		copyToClipboardButton.setIcon("files");

		const refreshButton = new ButtonComponent(buttonsContainer);
		refreshButton.setIcon("refresh-cw");

		copyToClipboardButton.buttonEl.addClass("llm-add-text");
		refreshButton.buttonEl.addClass("llm-refresh-output");

		// GPT4All & Image enter the non-streaming block
		// Claude, Gemini enter the streaming block
		if (streaming) {
			this.streamingDiv.empty();
		} else {
			const dots = this.streamingDiv.createEl("span");
			for (let i = 0; i < 3; i++) {
				const dot = dots.createEl("span", { cls: "streaming-dot" });
				dot.textContent = ".";
			}
		}

		this.streamingDiv.addClass("im-like-message");
		this.loadingDivContainer.addClass(
			"llm-flex-end",
			"im-like-message-container",
			"llm-flex"
		);

		copyToClipboardButton.onClick(async () => {
			await navigator.clipboard.writeText(this.previewText);
			new Notice("Text copied to clipboard");
		});

		refreshButton.onClick(async () => {
			new Notice("Regenerating response...");
			this.regenerateOutput();
		});
	}

	showThinkingAnimation() {
		this.streamingDiv.empty();
		const thinkingContainer = this.streamingDiv.createEl("div", {
			cls: "llm-thinking-animation"
		});
		thinkingContainer.createEl("span", {
			cls: "llm-thinking-text",
			text: "Thinking"
		});
		const dots = thinkingContainer.createEl("span", { cls: "llm-thinking-dots" });
		for (let i = 0; i < 3; i++) {
			const dot = dots.createEl("span", { cls: "streaming-dot" });
			dot.textContent = ".";
		}
		this.historyMessages.scroll(0, 9999);
	}

	appendImage(imageURLs: string[]) {
		imageURLs.map((url) => {
			const img = this.streamingDiv.createEl("img");
			img.src = url;
			img.alt = `image generated with ${this.prompt}`;
		});
	}

	/**
	 * Convert bare "filename.md" references in LLM responses to Obsidian
	 * wikilinks so MarkdownRenderer produces clickable .internal-link elements.
	 *
	 * Skips patterns already inside [[wikilinks]], markdown links (url), or
	 * URLs (containing ://).
	 */
	private linkifyMdRefs(text: string): string {
		// LLMs (especially smaller models) often wrap wiki-links in backticks:
		// `[[filename.md]]` → [[filename.md]]
		// Strip backtick wrapping so MarkdownRenderer treats them as real links.
		text = text.replace(/`(\[\[.*?\]\])`/g, "$1");

		// Negative lookbehind: don't match if preceded by [, (, or /
		// (catches [[already]], (url), and http://path/file.md).
		// Negative lookahead:  don't match if followed by ] or )
		// (catches the closing half of existing syntax).
		return text.replace(
			/(?<![\[(/])(\b[\w][\w ./-]*?\.md\b)(?![)\]])/g,
			"[[$1]]"
		);
	}

	/**
	 * Render markdown into a container and wire up internal Obsidian links so
	 * they open the target file when clicked, regardless of which view type
	 * (Modal, Widget, FAB) is hosting the chat.
	 */
	private async renderMarkdown(content: string, container: HTMLElement): Promise<void> {
		const sourcePath =
			this.plugin.app.workspace.getActiveFile()?.path ?? "";
		await MarkdownRenderer.render(
			this.plugin.app,
			this.linkifyMdRefs(content),
			container,
			sourcePath,
			this.plugin
		);
		// Hide inline copy-code buttons (we have our own copy action).
		container
			.querySelectorAll<HTMLElement>(".copy-code-button")
			.forEach((btn) => btn.setAttribute("style", "display: none"));
		// Wire up internal links (wikilinks rendered as .internal-link) so
		// clicking them opens the note in Obsidian.
		container
			.querySelectorAll<HTMLAnchorElement>("a.internal-link")
			.forEach((link) => {
				link.addEventListener("click", (e: MouseEvent) => {
					e.preventDefault();
					const href =
						link.getAttribute("data-href") ??
						link.getAttribute("href") ??
						"";
					this.plugin.app.workspace.openLinkText(
						href,
						sourcePath,
						e.ctrlKey || e.metaKey
					);
				});
			});
		// Some LLMs (especially smaller models) wrap wiki-links in backticks,
		// which survive as <code>[[file.md]]</code> even after linkifyMdRefs
		// strips the backticks — because MarkdownRenderer re-parses the markdown
		// and may re-wrap them as code spans in certain list contexts.
		// This post-processor converts any remaining [[...]] text in the rendered
		// DOM into real clickable internal links, regardless of their wrapper.
		this.linkifyRenderedWikilinks(container, sourcePath);
	}

	/**
	 * Walk the rendered DOM and replace any literal [[target]] text that
	 * MarkdownRenderer left un-linked with a real <a class="internal-link">.
	 *
	 * Handles two cases:
	 *  1. <code>[[file.md]]</code>  — replaces the whole <code> element.
	 *  2. Text nodes containing [[...]] — splits and inserts link elements.
	 *
	 * Skips <pre> blocks (fenced code) so genuine code examples are untouched.
	 */
	private linkifyRenderedWikilinks(container: HTMLElement, sourcePath: string): void {
		const WIKI_RE = /\[\[([^\]]+)\]\]/g;

		const makeLink = (target: string): HTMLAnchorElement => {
			const a = document.createElement("a");
			a.className = "internal-link";
			a.setAttribute("data-href", target);
			a.setAttribute("href", target);
			a.textContent = target;
			a.addEventListener("click", (e: MouseEvent) => {
				e.preventDefault();
				this.plugin.app.workspace.openLinkText(
					target,
					sourcePath,
					e.ctrlKey || e.metaKey
				);
			});
			return a;
		};

		// Case 1: <code> elements whose entire text is a [[...]] link.
		// Replace the <code> element with the link so we also remove the
		// code styling that makes the reference look like a code snippet.
		container.querySelectorAll<HTMLElement>("code").forEach((codeEl) => {
			if (codeEl.closest("pre")) return; // skip fenced code blocks
			const text = codeEl.textContent ?? "";
			const match = text.match(/^\[\[([^\]]+)\]\]$/);
			if (match) {
				codeEl.replaceWith(makeLink(match[1]));
			}
		});

		// Case 2: plain text nodes that still contain [[...]] patterns.
		// (These can appear when the model outputs [[file]] without backticks
		// but MarkdownRenderer left them as literal text for any reason.)
		const walker = document.createTreeWalker(
			container,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode(node) {
					// Skip text inside <pre> (fenced code blocks)
					if ((node.parentElement as HTMLElement)?.closest("pre")) {
						return NodeFilter.FILTER_REJECT;
					}
					// Skip text already inside an <a> (already a link)
					if ((node.parentElement as HTMLElement)?.closest("a")) {
						return NodeFilter.FILTER_REJECT;
					}
					return NodeFilter.FILTER_ACCEPT;
				},
			}
		);

		const textNodes: Text[] = [];
		let n: Node | null;
		while ((n = walker.nextNode())) {
			if (WIKI_RE.test(n.textContent ?? "")) {
				textNodes.push(n as Text);
			}
			WIKI_RE.lastIndex = 0; // reset stateful regex after test()
		}

		for (const textNode of textNodes) {
			const parent = textNode.parentNode;
			if (!parent) continue;

			const text = textNode.textContent ?? "";
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			let m: RegExpExecArray | null;
			WIKI_RE.lastIndex = 0;

			while ((m = WIKI_RE.exec(text)) !== null) {
				if (m.index > lastIndex) {
					fragment.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
				}
				fragment.appendChild(makeLink(m[1]));
				lastIndex = m.index + m[0].length;
			}

			if (lastIndex < text.length) {
				fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
			}

			parent.replaceChild(fragment, textNode);
		}
	}

	private async createMessage(
		content: string,
		index: number,
		finalMessage: Boolean,
		assistant: Boolean = false,
		toolCalls?: ToolCallRecord[]
	): Promise<void> {
		// Outer wrapper carries the alignment class so CSS selectors like
		// .llm-message-wrapper.llm-flex-start (bubble background) fire correctly.
		const messageWrapper = this.historyMessages.createDiv();
		messageWrapper.addClass("llm-message-wrapper");
		// llm-flex-start = user messages (right-aligned bubble)
		// llm-flex-end   = assistant messages (full-width transparent)
		messageWrapper.addClass(assistant ? "llm-flex-end" : "llm-flex-start");

		const imLikeMessageContainer = messageWrapper.createDiv();
		imLikeMessageContainer.addClass("im-like-message-container");

		if (assistant) {
			// Logo sits to the left of the content as a sibling inside the container
			imLikeMessageContainer.addClass("llm-flex");
			const logoEl = imLikeMessageContainer.createEl("div", { cls: "llm-assistant-logo" });
			logoEl.appendChild(assistantLogo());

			const contentWrap = imLikeMessageContainer.createDiv();
			contentWrap.addClass("llm-flex-column");

			// Collapsible tool call panel — shown when the agent used tools this turn
			if (toolCalls?.length) {
				this.appendToolCallsPanel(contentWrap, toolCalls);
			}

			const imLikeMessage = contentWrap.createDiv();
			imLikeMessage.addClass("im-like-message", classNames[this.viewType]["chat-message"]);
			await this.renderMarkdown(content, imLikeMessage);
		} else {
			const imLikeMessage = imLikeMessageContainer.createDiv();
			imLikeMessage.addClass("im-like-message", classNames[this.viewType]["chat-message"]);
			await this.renderMarkdown(content, imLikeMessage);
		}

		// Actions bar — revealed on hover of messageWrapper via CSS
		const actionsBar = messageWrapper.createDiv({ cls: "llm-message-actions" });

		const copyBtn = new ButtonComponent(actionsBar);
		copyBtn.setIcon("files");
		copyBtn.setTooltip("Copy to clipboard");
		copyBtn.buttonEl.addClass("clickable-icon");
		copyBtn.onClick(async () => {
			await navigator.clipboard.writeText(content);
			new Notice("Text copied to clipboard");
		});

		if (finalMessage) {
			const refreshBtn = new ButtonComponent(actionsBar);
			refreshBtn.setIcon("refresh-cw");
			refreshBtn.setTooltip("Regenerate response");
			refreshBtn.buttonEl.addClass("clickable-icon", "llm-refresh-output");
			refreshBtn.onClick(async () => {
				new Notice("Regenerating response...");
				this.regenerateOutput();
			});
		}
	}

	async generateIMLikeMessages(messages: Message[], gen?: number) {
		let finalMessage = false;
		let assistantIdx = 0;
		for (let index = 0; index < messages.length; index++) {
			// Abort if a newer render has been kicked off since this one started.
			// Each await inside createMessage (e.g. renderMarkdown) is a yield
			// point where updateMessages may have already called resetChat() and
			// started a fresh render. Continuing would write stale nodes into
			// the newly-cleared container, causing duplicated / out-of-order UI.
			if (gen !== undefined && gen !== this.renderGeneration) return;
			const { role, content } = messages[index];
			if (index === messages.length - 1) finalMessage = true;
			if (role === "assistant") {
				const toolCalls = this.allToolCallsByTurn.get(assistantIdx);
				await this.createMessage(content, index, finalMessage, true, toolCalls);
				assistantIdx++;
			} else {
				await this.createMessage(content, index, finalMessage);
			}
		}
		if (gen !== undefined && gen !== this.renderGeneration) return;
		this.historyMessages.scroll(0, 9999);
	}

	async appendNewMessage(message: Message) {
		const length = this.historyMessages.childNodes.length;
		const { content } = message;

		await this.createMessage(content, length, false);
	}
	removeLastMessageAndHistoryMessage() {
		const messages = this.messageStore.getMessages();
		messages.pop();
		this.messageStore.setMessages(messages);
		this.historyMessages.lastElementChild?.remove();
		if (this.plugin.settings.currentIndex >= 0) {
			this.plugin.history.update(this.plugin.settings.currentIndex, messages);
		}
	}

	removeMessage(header: Header, modelName: string) {
		this.removeLastMessageAndHistoryMessage();
		if (this.historyMessages.children.length < 1) {
			header.setHeader(modelName);
		}
	}

	resetChat() {
		this.historyMessages.empty();
		this.historyMessages.removeClass("center-llmgal");
		this.historyMessages.removeClass("llm-justify-content-center");
	}
	/**
	 * Refresh the active-file chip to the currently open file without
	 * disturbing conversation history or user-toggled scan state.
	 *
	 * - If the user has context ON (useActiveFileContext=true): swap the file
	 *   name to whatever is active now, or clear the chip if nothing is open.
	 * - If context is OFF because the user explicitly disabled it via the scan
	 *   button: leave it alone.
	 * - If context is OFF only because no file was active when the popover was
	 *   first built, but includeActiveFile is on and a file is now open: enable
	 *   it so the chip appears for the first time.
	 */
	refreshActiveFileChip() {
		const settingType = getSettingType(this.viewType);
		const includeActiveFile =
			this.plugin.settings[settingType].contextSettings.includeActiveFile;

		const hasConversation = this.getMessages().length > 0;

		if (this.useActiveFileContext) {
			// Mid-conversation: the user pointed at a file deliberately — keep it.
			// Only swap if no messages exist yet (chat hasn't started).
			if (hasConversation) return;

			// Context is on — update to the currently active file.
			const activeFile = this.plugin.app.workspace.getActiveFile();
			if (activeFile) {
				this.activeFileForChip = { name: activeFile.name, path: activeFile.path };
			} else {
				// No file open any more — turn the chip off cleanly.
				this.activeFileForChip = null;
				this.useActiveFileContext = false;
				this.scanButton?.buttonEl.removeClass("is-active");
			}
			this.syncChips();
		} else if (includeActiveFile && !this.activeFileForChip && !hasConversation) {
			// Context was never activated because no file was open at build
			// time. Try again now that the popover is being shown — but only
			// if the conversation hasn't started yet.
			const activeFile = this.plugin.app.workspace.getActiveFile();
			if (activeFile) {
				this.useActiveFileContext = true;
				this.activeFileForChip = { name: activeFile.name, path: activeFile.path };
				this.scanButton?.buttonEl.addClass("is-active");
				this.syncChips();
			}
		}
	}

	/**
	 * If the view is currently showing the empty state (no messages), re-renders
	 * it so changes to display settings (e.g. avatar) are reflected immediately.
	 */
	refreshEmptyState() {
		if (this.getMessages().length === 0) {
			this.historyMessages.empty();
			this.displayNoChatView(this.historyMessages);
		}
	}

	/**
	 * Re-reads the current default model from settings and updates the model
	 * dropdown to match. Call this whenever a popover is shown after settings
	 * may have changed (e.g. StatusBarButton.togglePopover, FAB toggle).
	 */
	syncModelDropdown() {
		if (!this.modelDropdown) return;
		const settingType = getSettingType(this.viewType);
		this.modelDropdown.setValue(this.plugin.settings[settingType].model);
		this.syncFileContextButtons();
	}

	/** Show or hide the file-context buttons based on the enableFileContext setting. */
	syncFileContextButtons() {
		const enabled = this.plugin.settings.enableFileContext;
		this.addFilesButton?.buttonEl.toggleClass("llm-hidden", !enabled);
		this.scanButton?.buttonEl.toggleClass("llm-hidden", !enabled);
	}

	/**
	 * Append a collapsible tool-call disclosure panel above the response,
	 * showing which tools the agent invoked during this turn.
	 */
	private appendToolCallsPanel(container: HTMLElement, toolCalls: ToolCallRecord[]): void {
		const count = toolCalls.length;
		const details = container.createEl("details", { cls: "llm-tool-calls" });

		const summary = details.createEl("summary", { cls: "llm-tool-calls-summary" });
		const iconEl = summary.createEl("span", { cls: "llm-tool-calls-icon" });
		setIcon(iconEl, "wrench");
		summary.createEl("span", {
			cls: "llm-tool-calls-label",
			text: count === 1 ? "1 tool call" : `${count} tool calls`,
		});
		const chevronEl = summary.createEl("span", { cls: "llm-tool-calls-chevron" });
		setIcon(chevronEl, "chevron-down");

		const body = details.createEl("div", { cls: "llm-tool-calls-body" });
		for (const tc of toolCalls) {
			const item = body.createEl("div", { cls: "llm-tool-call-item" });
			item.createEl("span", { cls: "llm-tool-call-name", text: tc.name });
			const inputStr = JSON.stringify(tc.input);
			const truncated = inputStr.length > 300 ? inputStr.slice(0, 297) + "…" : inputStr;
			item.createEl("code", { cls: "llm-tool-call-input", text: truncated });
		}
	}

	/**
	 * Append a collapsible "Sources" disclosure panel to the response container
	 * listing the vault files that contributed context to this response.
	 */
	private appendSourcesPanel(container: HTMLElement, sourcePaths: string[]): void {
		const details = container.createEl("details", { cls: "llm-rag-sources" });
		const summary = details.createEl("summary", { cls: "llm-rag-sources-summary" });
		summary.setText(`${sourcePaths.length} source${sourcePaths.length !== 1 ? "s" : ""}`);

		const list = details.createEl("ul", { cls: "llm-rag-sources-list" });
		for (const path of sourcePaths) {
			const item = list.createEl("li");
			const link = item.createEl("a", { cls: "llm-rag-source-link", text: path });
			link.addEventListener("click", (e) => {
				e.preventDefault();
				const file = this.plugin.app.vault.getAbstractFileByPath(path);
				if (file) {
					this.plugin.app.workspace.getLeaf(false).openFile(file as import("obsidian").TFile);
				}
			});
		}
	}

	newChat() {
		this.historyMessages.empty();
		this.claudeCodeSessionId = null;
		this.pendingToolCalls = [];
		this.allToolCallsByTurn = new Map();
		this.displayNoChatView(this.historyMessages);

		// Reset active file chip state, then re-evaluate from the current setting.
		// Without this, toggling the setting or switching chats left stale chip state.
		this.useActiveFileContext = false;
		this.activeFileForChip = null;
		this.scanButton?.buttonEl.removeClass("is-active");

		const settingType = getSettingType(this.viewType);
		if (
			this.plugin.settings.enableFileContext &&
			this.plugin.settings[settingType].contextSettings.includeActiveFile
		) {
			const activeFile = this.plugin.app.workspace.getActiveFile();
			if (activeFile) {
				this.useActiveFileContext = true;
				this.activeFileForChip = { name: activeFile.name, path: activeFile.path };
				this.scanButton?.buttonEl.addClass("is-active");
			}
		}

		this.syncChips();
	}
}

// ── RAG helpers ───────────────────────────────────────────────────────────────

/** Format raw search results into an injectable markdown context block. */
function formatRagResultsAsContext(results: import("RAG/VaultIndexer").SearchResult[]): string {
	const lines: string[] = [
		"## Relevant notes from your vault",
		"",
		"The following excerpts were retrieved based on semantic similarity to your query.",
		"Use them to inform your response where relevant.",
		"",
	];
	for (const result of results) {
		lines.push(`### ${result.filePath}`);
		lines.push(result.text);
		lines.push("");
	}
	return lines.join("\n");
}

/**
 * Extract vault-relative file paths from a formatted RAG context block.
 * Looks for `### path/to/note.md` lines produced by formatRagResultsAsContext.
 */
function extractRagSourcePaths(contextText: string): string[] {
	const paths: string[] = [];
	for (const line of contextText.split("\n")) {
		const match = line.match(/^### (.+\.md)$/);
		if (match) paths.push(match[1]);
	}
	return paths;
}
