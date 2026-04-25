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
	ViewType,
} from "Types/types";
import { classNames } from "utils/classNames";
import {
	assistant,
	chat,
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
	messages,
	ollama,
	mistral,
} from "utils/constants";

import assistantLogo from "Plugin/Components/AssistantLogo";
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
} from "utils/utils";
import { models, modelNames } from "utils/models";
import { Header } from "./Header";
import { MessageStore } from "./MessageStore";
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
	contextBuilder: ContextBuilder;
	currentVaultContext: any = null; // Store context for current generation
	pendingContextString: string | null = null; // Context string to inject into API call (not shown in UI)
	claudeCodeSessionId: string | null = null;
	useActiveFileContext: boolean = false;
	chipContainer: HTMLElement | null = null;
	scanButton: ButtonComponent | null = null;
	activeFileForChip: { name: string } | null = null;
	constructor(
		private plugin: LLMPlugin,
		viewType: ViewType,
		messageStore: MessageStore
	) {
		this.viewType = viewType;
		this.messageStore = messageStore;
		this.messageStore.subscribe(this.updateMessages.bind(this));
		this.contextBuilder = new ContextBuilder(this.plugin.app);
	}

	private updateMessages(message: Message[]) {
		const currentIndex = this.plugin.settings.currentIndex;
		const fabIndex = this.plugin.settings.fabSettings.historyIndex;
		const widgetIndex = this.plugin.settings.widgetSettings.historyIndex;

		if (currentIndex > -1) {
			message = this.plugin.settings.promptHistory[currentIndex].messages;
		}

		// Always update the current view
		if (this.viewType === this.plugin.settings.currentView) {
			this.resetChat();
			this.generateIMLikeMessages(message);
			return;
		}

		// Update FAB view if it's showing the same history item
		if (
			this.viewType === "floating-action-button" &&
			fabIndex === currentIndex &&
			currentIndex > -1
		) {
			this.resetChat();
			this.generateIMLikeMessages(message);
			return;
		}

		// Update Widget view if it's showing the same history item
		if (
			this.viewType === "widget" &&
			widgetIndex === currentIndex &&
			currentIndex > -1
		) {
			this.resetChat();
			this.generateIMLikeMessages(message);
			return;
		}
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
		if (endpoint === "images") {
			const params: ImageParams = {
				prompt: this.prompt,
				messages: messagesForParams,
				model,
				...this.plugin.settings[settingType].imageSettings,
			};
			return params;
		}

		if (endpoint === chat) {
			if (modelType === ollama || modelType === mistral || modelType === GPT4All) {
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
				// The Claude API accepts the most recent user message
				// as well as an optional most recent assistant message.
				// This initial approach only sends the most recent user message.
				messages: messagesForParams.slice(-1),
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
		let shouldHaveAPIKey = modelType !== GPT4All && modelType !== ollama && modelType !== mistral && modelEndpoint !== claudeCodeEndpoint;
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
							if (block.type === "text") {
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
			MarkdownRenderer.render(
				this.plugin.app,
				this.previewText,
				this.streamingDiv,
				"",
				this.plugin
			);
			const copyButton = this.streamingDiv.querySelectorAll(
				".copy-code-button"
			) as NodeListOf<HTMLElement>;
			copyButton.forEach((item) => {
				item.setAttribute("style", "display: none");
			});
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
					if (firstChunk) {
						this.streamingDiv.empty();
						firstChunk = false;
					}
					this.previewText += chunk.text || "";
					this.streamingDiv.textContent = this.previewText;
					this.historyMessages.scroll(0, 9999);
				}
			} catch (err) {
				console.error(err);
				return false;
			}

			this.streamingDiv.empty();
			MarkdownRenderer.render(
				this.plugin.app,
				this.previewText,
				this.streamingDiv,
				"",
				this.plugin
			);
			const copyButton = this.streamingDiv.querySelectorAll(
				".copy-code-button"
			) as NodeListOf<HTMLElement>;
			copyButton.forEach((item) => {
				item.setAttribute("style", "display: none");
			});
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
				if (firstText) {
					this.streamingDiv.empty();
					firstText = false;
				}
				this.previewText += text || "";
				this.streamingDiv.textContent = this.previewText;
				this.historyMessages.scroll(0, 9999);
			});

			this.streamingDiv.empty();
			MarkdownRenderer.render(
				this.plugin.app,
				this.previewText,
				this.streamingDiv,
				"",
				this.plugin
			);
			const copyButton = this.streamingDiv.querySelectorAll(
				".copy-code-button"
			) as NodeListOf<HTMLElement>;
			copyButton.forEach((item) => {
				item.setAttribute("style", "display: none");
			});
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
				if (firstChunk) {
					this.streamingDiv.empty();
					firstChunk = false;
				}
				this.previewText += chunk.choices[0]?.delta?.content || "";
				this.streamingDiv.textContent = this.previewText;
				this.historyMessages.scroll(0, 9999);
			}
			this.streamingDiv.empty();
			MarkdownRenderer.render(
				this.plugin.app,
				this.previewText,
				this.streamingDiv,
				"",
				this.plugin
			);
			const copyButton = this.streamingDiv.querySelectorAll(
				".copy-code-button"
			) as NodeListOf<HTMLElement>;
			copyButton.forEach((item) => {
				item.setAttribute("style", "display: none");
			});
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
				if (firstChunk) {
					this.streamingDiv.empty();
					firstChunk = false;
				}
				this.previewText += chunk.choices[0]?.delta?.content || "";
				this.streamingDiv.textContent = this.previewText;
				this.historyMessages.scroll(0, 9999);
			}
			this.streamingDiv.empty();
			MarkdownRenderer.render(
				this.plugin.app,
				this.previewText,
				this.streamingDiv,
				"",
				this.plugin
			);
			const copyButton = this.streamingDiv.querySelectorAll(
				".copy-code-button"
			) as NodeListOf<HTMLElement>;
			copyButton.forEach((item) => {
				item.setAttribute("style", "display: none");
			});
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
			MarkdownRenderer.render(
				this.plugin.app,
				this.previewText,
				this.streamingDiv,
				"",
				this.plugin
			);
			const copyButton = this.streamingDiv.querySelectorAll(
				".copy-code-button"
			) as NodeListOf<HTMLElement>;
			copyButton.forEach((item) => {
				item.setAttribute("style", "display: none");
			});
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

		// Only build context for chat endpoints (not images) and if feature is enabled
		if (modelEndpoint !== "images" && this.plugin.settings.enableFileContext) {
			try {
				contextString = await this.contextBuilder.buildFormattedContext(
					contextSettings,
					contextTokenBudget
				);
				if (contextString) {
					vaultContext = await this.contextBuilder.buildContext(contextSettings);
					// Store for use in historyPush
					this.currentVaultContext = vaultContext;
					// Store context string to be injected into API params (not rendered in UI)
					this.pendingContextString = contextString;
				}
			} catch (error) {
				console.error("Error building vault context:", error);
			}
		}

		// Active file context toggle (explicit user action via scan button, FAB/Modal only)
		if (this.useActiveFileContext && this.viewType !== "widget" && modelEndpoint !== "images") {
			try {
				const activeFile = this.plugin.app.workspace.getActiveFile();
				if (activeFile) {
					const content = await this.plugin.app.vault.read(activeFile);
					const activeFileContextString =
						`# Active File: ${activeFile.name}\nPath: \`${activeFile.path}\`\n\n\`\`\`\n${content}\n\`\`\`\n`;
					// Override any previously built context string — explicit toggle wins
					this.pendingContextString = activeFileContextString;
					this.currentVaultContext = {
						activeFile: { path: activeFile.path, name: activeFile.name, content },
						additionalFiles: [],
					};
				}
			} catch (error) {
				console.error("Error reading active file for context:", error);
			}
		}

		const userMessage = { role: "user" as const, content: this.prompt };
		this.messageStore.addMessage(userMessage);
		// Only manually append if subscription won't handle rendering
		// (i.e., when this view is not the current active view)
		if (this.viewType !== this.plugin.settings.currentView) {
			this.appendNewMessage(userMessage);
		}
		const params = this.getParams(modelEndpoint, model, modelType);
		try {
			this.previewText = "";
			if (modelEndpoint !== "images") {
				await this.handleGenerate();
				// Clear context after generation
				this.currentVaultContext = null;
				this.pendingContextString = null;
			}
			if (modelEndpoint === "images") {
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
			errorMessages(error, params);
			if (this.getMessages().length > 0) {
				setTimeout(() => {
					this.removeMessage(header, modelName);
				}, 1000);
			}
		}
	}

	historyPush(params: HistoryItem, vaultContext?: any) {
		const { modelName, historyIndex, modelEndpoint } =
			getViewInfo(this.plugin, this.viewType);
		if (historyIndex > -1) {
			this.plugin.history.overwriteHistory(
				this.getMessages(),
				historyIndex
			);
			return;
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
			});
		}
		if (modelEndpoint === "images") {
			this.plugin.history.push({
				...(params as ImageHistoryItem),
				modelName,
			});
		}
		const length = this.plugin.settings.promptHistory.length;
		setHistoryIndex(this.plugin, this.viewType, length);
		this.plugin.saveSettings();
		this.prompt = "";
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
		const modelDropdown = new DropdownComponent(toolbarSection);
		modelDropdown.selectEl.addClass("llm-model-select");
		for (const modelDisplayName of Object.keys(models)) {
			if (models[modelDisplayName].type === GPT4All) {
				const gpt4AllPath = getGpt4AllPath(this.plugin);
				const fullPath = `${gpt4AllPath}/${models[modelDisplayName].model}`;
				if (this.plugin.fileSystem.existsSync(fullPath)) {
					modelDropdown.addOption(models[modelDisplayName].model, modelDisplayName);
				}
			} else {
				modelDropdown.addOption(models[modelDisplayName].model, modelDisplayName);
			}
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

		// Scan / use-file-as-context button (FAB and Modal only)
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
						this.activeFileForChip = { name: activeFile.name };
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

		// Send button
		const sendButton = new ButtonComponent(toolbarRight);
		sendButton.buttonEl.addClass(
			classNames[this.viewType].button,
			"llm-send-button"
		);
		sendButton.setIcon("up-arrow-with-tail");
		sendButton.setTooltip("Send prompt");

		promptField.setPlaceholder("Send a message...");

		promptField.onChange((change: string) => {
			this.prompt = change;
			promptField.setValue(change);
		});
		promptField.inputEl.addEventListener("keydown", (event) => {
			if (sendButton.disabled === true) return;

			if (event.code == "Enter") {
				event.preventDefault();
				this.handleGenerateClick(header, sendButton);
				promptField.inputEl.setText("");
				promptField.setValue("");
			}
		});
		sendButton.onClick(() => {
			this.handleGenerateClick(header, sendButton);
			promptField.inputEl.setText("");
			promptField.setValue("");
		});

		// Auto-focus the input field when the container is created
		setTimeout(() => {
			promptField.inputEl.focus();
		}, 100);
	}

	setMessages(replaceChatHistory: boolean = false) {
		const { historyIndex } = getViewInfo(this.plugin, this.viewType);
		if (replaceChatHistory) {
			let history = this.plugin.settings.promptHistory;
			this.messageStore.setMessages(history[historyIndex].messages);
		}
		if (!replaceChatHistory) {
			this.messageStore.addMessage({
				role: "user",
				content: this.prompt,
			});
		}
	}

	resetMessages() {
		this.messageStore.setMessages([]);
		this.claudeCodeSessionId = null;
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
	}

	appendImage(imageURLs: string[]) {
		imageURLs.map((url) => {
			const img = this.streamingDiv.createEl("img");
			img.src = url;
			img.alt = `image generated with ${this.prompt}`;
		});
	}

	private createMessage(
		content: string,
		index: number,
		finalMessage: Boolean,
		assistant: Boolean = false
	) {
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
			const imLikeMessage = contentWrap.createDiv();
			imLikeMessage.addClass("im-like-message", classNames[this.viewType]["chat-message"]);
			MarkdownRenderer.render(this.plugin.app, content, imLikeMessage, "", this.plugin);
			imLikeMessage.querySelectorAll(".copy-code-button").forEach((item: Element) => {
				(item as HTMLElement).setAttribute("style", "display: none");
			});
		} else {
			const imLikeMessage = imLikeMessageContainer.createDiv();
			imLikeMessage.addClass("im-like-message", classNames[this.viewType]["chat-message"]);
			MarkdownRenderer.render(this.plugin.app, content, imLikeMessage, "", this.plugin);
			imLikeMessage.querySelectorAll(".copy-code-button").forEach((item: Element) => {
				(item as HTMLElement).setAttribute("style", "display: none");
			});
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

	generateIMLikeMessages(messages: Message[]) {
		let finalMessage = false;
		messages.map(({ role, content }, index) => {
			if (index === messages.length - 1) finalMessage = true;
			if (role === "assistant") {
				this.createMessage(content, index, finalMessage, true);
				return;
			}
			this.createMessage(content, index, finalMessage);
		});
		this.historyMessages.scroll(0, 9999);
	}

	appendNewMessage(message: Message) {
		const length = this.historyMessages.childNodes.length;
		const { content } = message;

		this.createMessage(content, length, false);
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
	newChat() {
		this.historyMessages.empty();
		this.claudeCodeSessionId = null;
		this.displayNoChatView(this.historyMessages);
	}
}
