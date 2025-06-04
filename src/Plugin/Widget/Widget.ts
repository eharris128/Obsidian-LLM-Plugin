import { AssistantsContainer } from "Plugin/Components/AssistantsContainer";
import { ChatContainer } from "Plugin/Components/ChatContainer";
import { Header } from "Plugin/Components/Header";
import { HistoryContainer } from "Plugin/Components/HistoryContainer";
import { SettingsContainer } from "Plugin/Components/SettingsContainer";
import LLMPlugin from "main";
import { ItemView, WorkspaceLeaf } from "obsidian";
import { classNames } from "utils/classNames";
import { getViewInfo, setView } from "utils/utils";

export const TAB_VIEW_TYPE = "tab-view";

export class WidgetView extends ItemView {
	plugin: LLMPlugin;
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

	async onOpen() {
<<<<<<< HEAD
		this.icon = "message-circle";
=======
		this.icon = "bot-message-square"
>>>>>>> d2dfd5759a73c3c39631a26433e1d57c72e10a4f
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
		const header = new Header(this.plugin, "widget");
		const chatContainer = new ChatContainer(
			this.plugin,
			"widget",
			this.plugin.messageStore
		);
		const historyContainer = new HistoryContainer(this.plugin, "widget");
		const settingsContainer = new SettingsContainer(this.plugin, "widget");
		const assistantsContainer = new AssistantsContainer(
			this.plugin,
			"widget"
		);

		const lineBreak = container.createDiv();
		const chatContainerDiv = container.createDiv();
		const chatHistoryContainer = container.createDiv();
		const settingsContainerDiv = container.createDiv();
		const assistantContainerDiv = container.createDiv();

		settingsContainerDiv.setAttr("style", "display: none");
		settingsContainerDiv.addClass(
			"llm-widget-settings-container",
			"llm-flex"
		);
		assistantContainerDiv.setAttr("style", "display: none");
		assistantContainerDiv.addClass(
			"llm-widget-assistant-container",
			"llm-flex",
			"llm-widget-tab-assistants"
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
			assistantContainerDiv,
			chatContainer,
			historyContainer,
			settingsContainer,
			assistantsContainer
		);
		chatContainer.generateChatContainer(chatContainerDiv, header);
		historyContainer.generateHistoryContainer(
			chatHistoryContainer,
			history,
			chatContainerDiv,
			chatContainer,
			header
		);
		settingsContainer.generateSettingsContainer(
			settingsContainerDiv,
			header
		);
		assistantsContainer.generateAssistantsContainer(settingsContainerDiv);
	}

	async onClose() {}
}
