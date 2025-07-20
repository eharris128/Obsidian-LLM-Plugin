import { AssistantsContainer } from "Plugin/Components/AssistantsContainer";
import { ChatContainer } from "Plugin/Components/ChatContainer";
import { Header } from "Plugin/Components/Header";
import { HistoryContainer } from "Plugin/Components/HistoryContainer";
import { SettingsContainer } from "Plugin/Components/SettingsContainer";
import LLMPlugin from "main";
import { ButtonComponent } from "obsidian";
import { classNames } from "utils/classNames";
import { getViewInfo, setView } from "utils/utils";

const ROOT_WORKSPACE_CLASS = ".mod-vertical.mod-root";

export class FAB {
	plugin: LLMPlugin;
	constructor(plugin: LLMPlugin) {
		this.plugin = plugin;
	}

	generateFAB() {
		const fabContainer = createDiv();
		fabContainer.addEventListener("mouseenter", () => {
			const { historyIndex } = getViewInfo(
				this.plugin,
				"floating-action-button"
			);
			setView(this.plugin, "floating-action-button");
			this.plugin.settings.currentIndex = historyIndex;
			this.plugin.saveSettings();
		});
		fabContainer.setAttribute("class", `floating-action-button`);
		fabContainer.setAttribute("id", "_floating-action-button");
		const viewArea = fabContainer.createDiv();
		viewArea.addClass("fab-view-area");
		viewArea.setAttr("style", "display: none");
		const header = new Header(this.plugin, "floating-action-button");
		const chatContainer = new ChatContainer(
			this.plugin,
			"floating-action-button",
			this.plugin.messageStore
		);
		const historyContainer = new HistoryContainer(
			this.plugin,
			"floating-action-button"
		);
		const settingsContainer = new SettingsContainer(
			this.plugin,
			"floating-action-button"
		);
		const assistantsContainer = new AssistantsContainer(
			this.plugin,
			"floating-action-button"
		);

		const lineBreak = viewArea.createDiv();
		const chatContainerDiv = viewArea.createDiv();
		const chatHistoryContainer = viewArea.createDiv();
		const settingsContainerDiv = viewArea.createDiv();
		const assistantsContainerDiv = viewArea.createDiv();
		header.generateHeader(
			viewArea,
			chatContainerDiv,
			chatHistoryContainer,
			settingsContainerDiv,
			assistantsContainerDiv,
			chatContainer,
			historyContainer,
			settingsContainer,
			assistantsContainer
		);
		let history = this.plugin.settings.promptHistory;

		settingsContainerDiv.setAttr("style", "display: none");
		settingsContainerDiv.addClass("fab-settings-container", "llm-flex");
		assistantsContainerDiv.setAttr("style", "display: none");
		assistantsContainerDiv.addClass("fab-assistants-container", "llm-flex");
		chatHistoryContainer.setAttr("style", "display: none");
		chatHistoryContainer.addClass("fab-chat-history-container", "llm-flex");
		lineBreak.className =
			classNames["floating-action-button"]["title-border"];
		chatContainerDiv.addClass("fab-chat-container", "llm-flex");

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

		let button = new ButtonComponent(fabContainer);
		button
			.setIcon("bot-message-square")
			.setClass("buttonItem")
			.onClick(() => {
				if (!viewArea.isShown()) {
					viewArea.setAttr("style", "display: block");
				} else {
					viewArea.hide();
				}
			});

		document.body
			.querySelector(ROOT_WORKSPACE_CLASS)
			?.insertAdjacentElement("afterbegin", fabContainer);
	}

	removeFab() {
		const FAB = document.getElementById("_floating-action-button");
		if (FAB) {
			FAB.remove();
		}
	}

	regenerateFAB() {
		this.removeFab();
		this.generateFAB();
	}
}
