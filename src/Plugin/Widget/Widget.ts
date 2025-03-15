import { AssistantsContainer } from "Plugin/Components/AssistantsContainer";
import { ChatContainer } from "Plugin/Components/ChatContainer";
import { Header } from "Plugin/Components/Header";
import { HistoryContainer } from "Plugin/Components/HistoryContainer";
import { SettingsContainer } from "Plugin/Components/SettingsContainer";
import LLMPlugin from "main";
import { ItemView, WorkspaceLeaf } from "obsidian";
import { classNames } from "utils/classNames";

export const TAB_VIEW_TYPE = "tab-view";
export const LEAF_VIEW_TYPE = "leaf-view";

export class WidgetView extends ItemView {
	plugin: LLMPlugin;
	viewType: string
	constructor(leaf: WorkspaceLeaf, plugin: LLMPlugin, viewType: string) {
		super(leaf);
		this.plugin = plugin;
		this.viewType = viewType
	}

	getViewType(): string {
		return (this.viewType === "tab" ? TAB_VIEW_TYPE : LEAF_VIEW_TYPE);
		//return an empty tring because workspace.getLeavesOfType function in widget commands uses this to determine what
		//view is open an causes issues if you want to be able to have commands that open a tab view and a sidebar view separately
		//The only issue now is that users can open an infinite number of widgets which is probably not ideal behavior
		//can either solve this issue with over engineering, leave it, or create a whole new class that exactly the same as this class for the tabs
	}

	getDisplayText(): string {
		return "LLM";
	}

	async onOpen() {
		this.icon = "message-circle"
		const container = this.containerEl.children[1];
		const history = this.plugin.settings.promptHistory;
		container.empty();
		const header = new Header(this.plugin, "widget");
		const chatContainer = new ChatContainer(
			this.plugin,
			"widget" /*, closeModal*/
		);
		const historyContainer = new HistoryContainer(this.plugin, "widget");
		const settingsContainer = new SettingsContainer(this.plugin, "widget");
		const assistantsContainer = new AssistantsContainer(this.plugin, "widget")

		const lineBreak = container.createDiv();
		const chatContainerDiv = container.createDiv();
		const chatHistoryContainer = container.createDiv();
		const settingsContainerDiv = container.createDiv();
		const assistantContainerDiv = container.createDiv();

		settingsContainerDiv.setAttr("style", "display: none");
		settingsContainerDiv.addClass("llm-widget-settings-container", "llm-flex");
		assistantContainerDiv.setAttr("style", "display: none");
		assistantContainerDiv.addClass("llm-widget-assistant-container", "llm-flex");
		this.viewType === "tab" ? assistantContainerDiv.addClass("llm-widget-tab-assistants") : assistantContainerDiv.addClass("llm-widget-sidebar-assistants")
		chatHistoryContainer.setAttr("style", "display: none");
		chatHistoryContainer.addClass("llm-widget-chat-history-container", "llm-flex");
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
			assistantsContainer,
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
		assistantsContainer.generateAssistantsContainer(settingsContainerDiv)
	}

	async onClose() {}
}
