import LLMPlugin from "main";
import {
	ButtonComponent,
	MarkdownRenderer,
	Notice,
	TextAreaComponent,
} from "obsidian";
import { ChatCompletionChunk, Images } from "openai/resources";
import { Stream } from "openai/streaming";
import { errorMessages } from "Plugin/Errors/errors";
import {
	AssistantHistoryItem,
	AssistantParams,
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
	gemini,
	geminiModel,
	GPT4All,
	messages,
} from "utils/constants";
import assistantLogo from "Plugin/Components/AssistantLogo";
import {
	assistantsMessage,
	getSettingType,
	getViewInfo,
	messageGPT4AllServer,
	claudeMessage,
	geminiMessage,
	openAIMessage,
	setHistoryIndex,
} from "utils/utils";
import { Header } from "./Header";
import { MessageStore } from "./MessageStore";

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
	constructor(
		private plugin: LLMPlugin,
		viewType: ViewType,
		messageStore: MessageStore
	) {
		this.viewType = viewType;
		this.messageStore = messageStore;
		this.messageStore.subscribe(this.updateMessages.bind(this));
	}

	private updateMessages(messages: Message[]) {
		const { historyIndex } = getViewInfo(this.plugin, this.viewType);
		if (historyIndex === this.plugin.settings.currentIndex) {
			this.resetChat();
			this.generateIMLikeMessages(messages);
		}
		return;
	}

	getMessages() {
		return this.messageStore.getMessages();
	}

	getParams(endpoint: string, model: string, modelType: string) {
		const settingType = getSettingType(this.viewType);
		const messagesForParams = this.getMessages();

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
				...this.plugin.settings[settingType].chatSettings.gemini,
			};
			return params;
		}
		if (modelType === assistant) {
			const params: AssistantParams = {
				prompt: this.prompt,
				messages: messagesForParams,
				model,
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
			if (modelType === GPT4All) {
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
			};
			return params;
		}
	}

	async regenerateOutput() {
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
			assistantId,
			modelName,
		} = getViewInfo(this.plugin, this.viewType);
		let shouldHaveAPIKey = modelType !== GPT4All;
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
		const params = this.getParams(modelEndpoint, model, modelType);
		// Start assistant handling
		if (modelEndpoint === assistant) {
			const stream = await assistantsMessage(
				this.plugin.settings.openAIAPIKey,
				messagesForParams,
				assistantId
			);
			stream.on("textCreated", () => this.setDiv(true));
			stream.on("textDelta", (textDelta, snapshot) => {
				if (textDelta.value?.includes("【")) return;
				this.previewText += textDelta.value;
				this.streamingDiv.textContent = this.previewText;
				this.historyMessages.scroll(0, 9999);
			});
			return new Promise((resolve) => {
				stream.on("end", () => {
					this.streamingDiv.empty();
					MarkdownRenderer.render(
						this.plugin.app,
						this.previewText,
						this.streamingDiv,
						"",
						this.plugin
					);
					this.historyMessages.scroll(0, 9999);
					this.messageStore.addMessage({
						role: assistant,
						content: this.previewText,
					});
					const message_context = {
						...params,
						messages: messagesForParams,
						assistant_id: assistantId,
						modelName,
					} as AssistantHistoryItem;
					this.historyPush(message_context);
					resolve(true);
				});
			});
		}
		// End assistant handling

		if (model === geminiModel) {
			const stream = await geminiMessage(
				params as ChatParams,
				this.plugin.settings.geminiAPIKey
			);
			this.setDiv(true);

			try {
				for await (const chunk of stream.stream) {
					this.previewText += chunk.text() || "";
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
				messages: messagesForParams,
			} as ChatHistoryItem;
			this.historyPush(message_context);
			return true;
		}

		if (modelEndpoint === messages) {
			const stream = await claudeMessage(
				params as ChatParams,
				this.plugin.settings.claudeAPIKey
			);
			this.setDiv(true);

			stream.on("text", (text) => {
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
				messages: messagesForParams,
			} as ChatHistoryItem;
			this.historyPush(message_context);
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
					this.historyPush(params as ChatHistoryItem);
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
			this.historyPush(message_context);
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

		this.plugin.settings.currentIndex = historyIndex;
		this.plugin.saveSettings();

		// The refresh button should only be displayed on the most recent
		// assistant message.
		const refreshButton = this.historyMessages.querySelector(
			".llm-refresh-output"
		);
		refreshButton?.remove();

		if (this.historyMessages.children.length < 1) {
			header.setHeader(modelName, this.prompt);
		}
		this.messageStore.addMessage({ role: "user", content: this.prompt });
		const params = this.getParams(modelEndpoint, model, modelType);
		try {
			this.previewText = "";
			if (modelEndpoint !== "images") {
				await this.handleGenerate();
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
						content += `![created with prompt ${this.prompt}](${url})`;
					});
					this.messageStore.addMessage({
						role: assistant,
						content,
					});
					this.appendImage(response);
					this.historyPush({
						...params,
						messages: this.getMessages(),
					} as ImageHistoryItem);
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

	historyPush(params: HistoryItem) {
		const { modelName, historyIndex, modelEndpoint, assistantId } =
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
			modelEndpoint === messages
		) {
			this.plugin.history.push({
				...(params as ChatHistoryItem),
				modelName,
			});
		}
		if (modelEndpoint === "images") {
			this.plugin.history.push({
				...(params as ImageHistoryItem),
				modelName,
			});
		}
		if (modelEndpoint === assistant) {
			this.plugin.history.push({
				...(params as AssistantHistoryItem),
				modelName,
				assistant_id: assistantId,
			});
		}
		const length = this.plugin.settings.promptHistory.length;
		setHistoryIndex(this.plugin, this.viewType, length);
		this.plugin.saveSettings();
		this.prompt = "";
	}

	auto_height(elem: TextAreaComponent, parentElement: Element) {
		elem.inputEl.setAttribute("style", "height: 50px");
		const height = elem.inputEl.scrollHeight - 5;
		if (!(height > parseInt(window.getComputedStyle(elem.inputEl).height)))
			return;
		elem.inputEl.setAttribute("style", `height: ${height}px`);
		elem.inputEl.setAttribute("style", `overflow: hidden`);
		parentElement.scrollTo(0, 9999);
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
		const promptContainer = parentElement.createDiv();
		const promptField = new TextAreaComponent(promptContainer);
		const sendButton = new ButtonComponent(promptContainer);

		if (this.viewType === "floating-action-button") {
			promptContainer.addClass("llm-flex");
		}
		promptContainer.addClass(classNames[this.viewType]["prompt-container"]);
		promptField.inputEl.className = classNames[this.viewType]["text-area"];
		promptField.inputEl.id = "chat-prompt-text-area";
		promptContainer.addEventListener("input", () => {
			this.auto_height(promptField, parentElement);
		});
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
		finalMessage: Boolean
	) {
		const imLikeMessageContainer = this.historyMessages.createDiv();
		const imLikeMessage = imLikeMessageContainer.createDiv();
		const copyToClipboardButton = new ButtonComponent(
			imLikeMessageContainer
		);

		copyToClipboardButton.setIcon("files");

		MarkdownRenderer.render(
			this.plugin.app,
			content,
			imLikeMessage,
			"",
			this.plugin
		);
		const copyButton = imLikeMessage.querySelectorAll(
			".copy-code-button"
		) as NodeListOf<HTMLElement>;
		copyButton.forEach((item) => {
			item.setAttribute("style", "display: none");
		});
		imLikeMessageContainer.addClass(
			"im-like-message-container",
			"llm-flex"
		);
		copyToClipboardButton.buttonEl.addClass("add-text", "llm-hide");

		imLikeMessage.addClass(
			"im-like-message",
			classNames[this.viewType]["chat-message"]
		);
		if (index % 2 === 0) {
			imLikeMessageContainer.addClass("llm-flex-start", "llm-flex");
		} else {
			imLikeMessageContainer.addClass("llm-flex-end", "llm-flex");
		}

		imLikeMessageContainer.addEventListener("mouseenter", () => {
			copyToClipboardButton.buttonEl.removeClass("llm-hide");
		});

		imLikeMessageContainer.addEventListener("mouseleave", () => {
			copyToClipboardButton.buttonEl.addClass("llm-hide");
		});

		copyToClipboardButton.setTooltip("Copy to clipboard");
		copyToClipboardButton.onClick(async () => {
			await navigator.clipboard.writeText(content);
			new Notice("Text copied to clipboard");
		});

		if (finalMessage) {
			const refreshButton = new ButtonComponent(imLikeMessageContainer);

			refreshButton.setIcon("refresh-cw");
			refreshButton.buttonEl.addClass("llm-refresh-output", "llm-hide");

			imLikeMessageContainer.addEventListener("mouseenter", () => {
				refreshButton.buttonEl.removeClass("llm-hide");
			});

			imLikeMessageContainer.addEventListener("mouseleave", () => {
				refreshButton.buttonEl.addClass("llm-hide");
			});
			refreshButton.onClick(async () => {
				new Notice("Regenerating response...");
				this.regenerateOutput();
			});
		}
	}

	generateIMLikeMessages(messages: Message[]) {
		let finalMessage = false;
		messages.map(({ content }, index) => {
			if (index === messages.length - 1) finalMessage = true;
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
	}

	removeMessage(header: Header, modelName: string) {
		this.removeLastMessageAndHistoryMessage();
		if (this.historyMessages.children.length < 1) {
			header.setHeader(modelName, "LLM plugin");
		}
	}

	resetChat() {
		this.historyMessages.empty();
	}
}
