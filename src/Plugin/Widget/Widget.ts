import { ChatContainer } from "Plugin/Components/ChatContainer";
import { Header } from "Plugin/Components/Header";
import { HistoryContainer } from "Plugin/Components/HistoryContainer";
import { SettingsContainer } from "Plugin/Components/SettingsContainer";
import LLMPlugin from "main";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { classNames } from "utils/classNames";
import { getSettingType, getViewInfo, setHistoryFilePath, setView } from "utils/utils";
import { models } from "utils/models";

export const TAB_VIEW_TYPE = "tab-view";

export class WidgetView extends ItemView {
	plugin: LLMPlugin;
	private chatContainer: ChatContainer | null = null;
	private header: Header | null = null;
	private chatContainerDiv: HTMLElement | null = null;
	private chatHistoryContainer: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: LLMPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TAB_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "LLM";
	}

	/**
	 * Load a specific history conversation into this widget view.
	 * Safe to call whether the view was just opened or has been open for a while.
	 */
	loadConversation(index: number) {
		if (!this.chatContainer || index < 0 || !this.plugin.settings.promptHistory[index]) return;

		const settingType = getSettingType("widget");
		const historyItem = this.plugin.settings.promptHistory[index];

		// Sync model settings from the chosen history item
		if (historyItem?.modelName && models[historyItem.modelName]) {
			const m = models[historyItem.modelName];
			this.plugin.settings[settingType].modelName = historyItem.modelName;
			this.plugin.settings[settingType].model = m.model;
			this.plugin.settings[settingType].modelType = m.type;
			this.plugin.settings[settingType].modelEndpoint = m.endpoint;
			this.plugin.settings[settingType].endpointURL = m.url;
		}

		this.plugin.settings[settingType].historyIndex = index;
		this.plugin.settings.currentIndex = index;
		this.plugin.saveSettings();

		// Show chat, hide history/settings panels
		if (this.chatContainerDiv) this.chatContainerDiv.show();
		if (this.chatHistoryContainer) this.chatHistoryContainer.hide();

		// Switch to the correct MessageStore for this conversation.
		this.chatContainer.setMessages(true);

		// Explicitly re-render in case the store subscriber didn't fire
		// (e.g. same-store edge case or timing issue on first open).
		const messages = this.chatContainer.getMessages();
		if (messages.length > 0) {
			this.chatContainer.resetChat();
			this.chatContainer.generateIMLikeMessages(messages);
		}

		// Sync header state
		this.header?.setHeader(historyItem?.modelName ?? "");
		this.header?.resetHistoryButton();
		const displayTitle = historyItem?.prompt || historyItem?.messages[0]?.content || "";
		this.header?.setTitle(displayTitle);
	}

	/**
	 * Load a chat conversation directly from a vault markdown file path.
	 * Used when the user clicks the "Open in chat widget" action button on a chat file.
	 */
	async loadChatFile(filePath: string): Promise<void> {
		if (!this.chatContainer || !this.header) return;
		const settingType = getSettingType("widget");

		try {
			const { meta, messages, toolCallsByTurn } = await this.plugin.chatHistory.load(filePath);

			this.chatContainer.resetChat();
			this.chatContainer.setToolCallsByTurn(toolCallsByTurn);
			this.chatContainer.messageStore.setMessages(messages);
			this.chatContainer.generateIMLikeMessages(messages);

			if (this.chatContainerDiv) this.chatContainerDiv.show();
			if (this.chatHistoryContainer) this.chatHistoryContainer.hide();

			// Sync model settings from the file's stored model
			if (meta.model && models[meta.model]) {
				const m = models[meta.model];
				this.plugin.settings[settingType].model = meta.model;
				this.plugin.settings[settingType].modelName = meta.model;
				this.plugin.settings[settingType].modelType = m.type;
				this.plugin.settings[settingType].modelEndpoint = m.endpoint;
				this.plugin.settings[settingType].endpointURL = m.url;
			}

			// Track the file path so subsequent sends update the right file
			setHistoryFilePath(this.plugin, "widget", filePath);
			this.chatContainer.currentHistoryFilePath = filePath;

			this.header.setHeader(this.plugin.settings[settingType].modelName);
			this.header.resetHistoryButton();
			this.header.setTitle(meta.title ?? filePath);
			this.header.showTitle();
		} catch (e) {
			console.error("[WidgetView] Failed to load chat file:", e);
			new Notice("Failed to load conversation.");
		}
	}

	async onOpen() {
		this.icon = "bot-message-square"
		const container = this.containerEl.children[1];
		const history = this.plugin.settings.promptHistory;
		container.addEventListener("mouseenter", () => {
			const { historyIndex } = getViewInfo(
				this.plugin,
				"widget"
			);
			setView(this.plugin, "widget");
			this.plugin.settings.currentIndex = historyIndex;
			this.plugin.saveSettings();
		});
		container.empty();
		this.header = new Header(this.plugin, "widget");
		this.chatContainer = new ChatContainer(
			this.plugin,
			"widget",
			this.plugin.conversationRegistry
		);
		const chatContainer = this.chatContainer;
		const header = this.header;
		// Update the header title when the first message of a new conversation is sent
		chatContainer.headerTitleCallback = (title: string) => header.setTitle(title);
		const historyContainer = new HistoryContainer(this.plugin, "widget");
		const settingsContainer = new SettingsContainer(this.plugin, "widget");

		const lineBreak = container.createDiv();
		this.chatContainerDiv = container.createDiv();
		this.chatHistoryContainer = container.createDiv();
		const chatContainerDiv = this.chatContainerDiv;
		const chatHistoryContainer = this.chatHistoryContainer;
		const settingsContainerDiv = container.createDiv();

		settingsContainerDiv.setAttr("style", "display: none");
		settingsContainerDiv.addClass(
			"llm-widget-settings-container",
			"llm-flex"
		);
		chatHistoryContainer.setAttr("style", "display: none");
		chatHistoryContainer.addClass(
			"llm-widget-chat-history-container",
			"llm-flex"
		);
		lineBreak.className = classNames["widget"]["title-border"];
		chatContainerDiv.addClass("llm-widget-chat-container", "llm-flex");

		header.generateHeader(
			container,
			chatContainerDiv,
			chatHistoryContainer,
			settingsContainerDiv,
			chatContainer,
			historyContainer,
			settingsContainer
		);
		chatContainer.generateChatContainer(chatContainerDiv, header);
		historyContainer.generateHistoryContainer(
			chatHistoryContainer,
			history,
			chatContainerDiv,
			chatContainer,
			header
		);
		settingsContainer.generateSettingsContainer(settingsContainerDiv);

		// Auto-load a conversation if one was pending (set by "Open in sidebar/tab" from the FAB).
		const pendingIndex = this.plugin.pendingWidgetHistoryIndex;
		if (pendingIndex >= 0 && this.plugin.settings.promptHistory[pendingIndex]) {
			this.plugin.pendingWidgetHistoryIndex = -1;
			this.loadConversation(pendingIndex);
		}

		// Auto-load a chat file if one was pending (set by the view-action button on chat files).
		const pendingFilePath = this.plugin.pendingWidgetFilePath;
		if (pendingFilePath) {
			this.plugin.pendingWidgetFilePath = null;
			await this.loadChatFile(pendingFilePath);
		}
	}

	/** Delegates to ChatContainer so the empty state re-renders with the latest settings. */
	refreshEmptyState() {
		this.chatContainer?.refreshEmptyState();
	}

	async onClose() {
		this.chatContainer?.destroy();
		this.chatContainer = null;
		this.header = null;
		this.chatContainerDiv = null;
		this.chatHistoryContainer = null;
	}
}
