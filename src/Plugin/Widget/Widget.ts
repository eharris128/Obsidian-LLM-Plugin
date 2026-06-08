import { ChatContainer } from "Plugin/Components/ChatContainer";
import { logger } from "../../utils/logger";
import { ChatsSidebar } from "Plugin/Components/ChatsSidebar";
import { Header } from "Plugin/Components/Header";
import { HistoryContainer } from "Plugin/Components/HistoryContainer";
import { SettingsContainer } from "Plugin/Components/SettingsContainer";
import LLMPlugin from "main";
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { classNames } from "utils/classNames";
import { getSettingType, getViewInfo, setHistoryFilePath, setView } from "utils/utils";
import { models } from "utils/models";
import { TAB_VIEW_TYPE } from "utils/constants";

export { TAB_VIEW_TYPE };

export class WidgetView extends ItemView {
	plugin: LLMPlugin;
	private chatContainer: ChatContainer | null = null;
	private header: Header | null = null;
	private chatContainerDiv: HTMLElement | null = null;
	private chatHistoryContainer: HTMLElement | null = null;
	private detailsSidebarEl: HTMLElement | null = null;
	private chatsSidebarEl: HTMLElement | null = null;
	private chatsSidebar: ChatsSidebar | null = null;

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
		void this.plugin.saveSettings();

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
			const { meta, messages, toolCallsByTurn, skillsByTurn, modelsByTurn } = await this.plugin.chatHistory.load(filePath);

			this.chatContainer.resetChat();
			this.chatContainer.setToolCallsByTurn(toolCallsByTurn);
			this.chatContainer.setSkillsByTurn(skillsByTurn);
			this.chatContainer.setModelsByTurn(modelsByTurn);
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

			// Restore agent mode from the saved chat so the dropdown reflects
			// the model/assistant used in this conversation (not the current default).
			this.chatContainer.isObsidianAgent = !!meta.agent;

			// Track the file path so subsequent sends update the right file
			setHistoryFilePath(this.plugin, "widget", filePath);
			this.chatContainer.currentHistoryFilePath = filePath;

			// Restore (or clear) the active project based on file location / frontmatter
			this.chatContainer.restoreProjectFromChat(filePath, meta.project);

			this.header.setHeader(this.plugin.settings[settingType].modelName);
			this.header.resetHistoryButton();
			this.header.setTitle(meta.title ?? filePath);
			this.header.showTitle();

			// Sync the model dropdown to reflect the restored settings/agent mode.
			this.chatContainer.syncModelDropdown();

			// Push the fully-resolved state (model + project + files) to the
			// Chat Details panel.  restoreProjectFromChat() already called syncChips()
			// which calls pushChatDetailsState(), but that fires BEFORE the model
			// settings above are patched into plugin.settings, so we do one final
			// push here to make sure the model label is current.
			this.chatContainer.pushChatDetailsState();
		} catch (e) {
			logger.error("[WidgetView] Failed to load chat file:", e);
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
			void this.plugin.saveSettings();
		});
		container.empty();
		// Make the view-content div a flex column so bodyDiv's flex:1 works correctly
		(container as HTMLElement).addClass("llm-widget-root");
		this.header = new Header(this.plugin, "widget");
		this.chatContainer = new ChatContainer(
			this.plugin,
			"widget",
			this.plugin.conversationRegistry
		);
		const chatContainer = this.chatContainer;
		// Enable agent mode when set as the plugin-wide default.
		if (this.plugin.settings.defaultAgentMode) {
			chatContainer.isObsidianAgent = true;
		}
		const header = this.header;
		// Update the header title when the first message of a new conversation is sent
		chatContainer.headerTitleCallback = (title: string) => header.setTitle(title);
		const historyContainer = new HistoryContainer(this.plugin, "widget");
		const settingsContainer = new SettingsContainer(this.plugin, "widget", chatContainer);

		// Title border (hidden in tab-view via CSS, visible in modal/FAB)
		const lineBreak = container.createDiv();
		lineBreak.className = classNames["widget"]["title-border"];

		// Body: flex row → [chats sidebar] [main content] [details sidebar]
		const bodyDiv = container.createDiv({ cls: "llm-widget-body" });

		// Inline Chats sidebar (LEFT) — hidden until the toggle button is pressed.
		this.chatsSidebarEl = bodyDiv.createDiv({
			cls: "llm-widget-chats-sidebar",
		});

		const mainDiv = bodyDiv.createDiv({ cls: "llm-widget-main" });

		// Inline Chat Details sidebar (RIGHT) — hidden until the button is pressed.
		// Do NOT add llm-chat-details-content here: its flex:1 is designed for a
		// column flex parent and would break sizing in our row flex body.
		this.detailsSidebarEl = bodyDiv.createDiv({
			cls: "llm-widget-details-sidebar",
		});

		// Wire up sidebars to header (toggle buttons) and chatContainer (state rendering)
		header.chatsSidebarEl = this.chatsSidebarEl;
		header.detailsSidebarEl = this.detailsSidebarEl;
		chatContainer.detailsSidebarEl = this.detailsSidebarEl;

		// Populate the inline chats sidebar.
		// Wire onOpenFile so that clicking a chat row loads it directly into THIS
		// widget's ChatContainer rather than routing through the plugin's
		// openChatFileInWidget() (which would pick the wrong widget when multiple
		// widget tabs are open simultaneously).
		this.chatsSidebar = new ChatsSidebar(this.plugin);
		this.chatsSidebar.onOpenFile = async (path: string) => {
			await this.loadChatFile(path);
		};
		this.chatsSidebar.render(this.chatsSidebarEl);

		// All content panels live inside mainDiv
		this.chatContainerDiv = mainDiv.createDiv();
		this.chatHistoryContainer = mainDiv.createDiv();
		const chatContainerDiv = this.chatContainerDiv;
		const chatHistoryContainer = this.chatHistoryContainer;
		const settingsContainerDiv = mainDiv.createDiv();

		settingsContainerDiv.hide();
		settingsContainerDiv.addClass("llm-widget-settings-container", "llm-flex");
		chatHistoryContainer.hide();
		chatHistoryContainer.addClass("llm-widget-chat-history-container", "llm-flex");
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
		// generateChatContainer is async; schedule an initial sidebar state push
		// so the inline sidebar has content the first time the user opens it,
		// even if no other action (chip sync, model change) has fired yet.
		setTimeout(() => chatContainer.pushChatDetailsState(), 0);
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

	/** Rebuilds the assistants optgroup in the model dropdown after hot-reload. */
	syncAssistantDropdownOptions() {
		this.chatContainer?.syncAssistantDropdownOptions();
	}

	/** Re-syncs the selected value in the model dropdown to match current settings. */
	syncModelDropdown() {
		this.chatContainer?.syncModelDropdown();
	}

	syncChips() {
		this.chatContainer?.syncChips();
	}

	syncMicButton() {
		this.chatContainer?.syncMicButton();
	}

	/** Sets agent mode on the chat container and refreshes the dropdown. */
	setAgentMode(enabled: boolean) {
		if (this.chatContainer) {
			this.chatContainer.isObsidianAgent = enabled;
			this.chatContainer.syncModelDropdown();
		}
	}

	async onClose() {
		this.chatContainer?.destroy();
		this.chatsSidebar?.destroy();
		this.chatContainer = null;
		this.chatsSidebar = null;
		this.header = null;
		this.chatContainerDiv = null;
		this.chatHistoryContainer = null;
		this.detailsSidebarEl = null;
		this.chatsSidebarEl = null;
	}
}
