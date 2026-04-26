import LLMPlugin from "main";
import { Modal } from "obsidian";
import { classNames } from "utils/classNames";
import { ChatContainer } from "../Components/ChatContainer";
import { Header } from "../Components/Header";
import { HistoryContainer } from "../Components/HistoryContainer";
import { SettingsContainer } from "../Components/SettingsContainer";
import { setHistoryIndex, setView } from "utils/utils";

export class ChatModal2 extends Modal {
	private chatContainer: ChatContainer | null = null;

	constructor(private plugin: LLMPlugin) {
		super(plugin.app);
	}

	onOpen() {
		setView(this.plugin, "modal");
		setHistoryIndex(this.plugin, "modal");
		this.plugin.settings.currentIndex = -1;
		this.plugin.saveSettings();
		this.modalEl
			.getElementsByClassName("modal-close-button")[0]
			.setAttr("style", "display: none");
		const { contentEl } = this;
		const header = new Header(this.plugin, "modal");
		// Modal always gets a fresh store — each opening starts a new conversation.
		this.chatContainer = new ChatContainer(
			this.plugin,
			"modal",
			this.plugin.conversationRegistry
		);
		const chatContainer = this.chatContainer;
		const historyContainer = new HistoryContainer(this.plugin, "modal");
		const settingsContainer = new SettingsContainer(this.plugin, "modal");

		const lineBreak = contentEl.createDiv();
		const chatContainerDiv = contentEl.createDiv();
		const chatHistoryContainer = contentEl.createDiv();
		const settingsContainerDiv = contentEl.createDiv();
		header.generateHeader(
			contentEl,
			chatContainerDiv,
			chatHistoryContainer,
			settingsContainerDiv,
			chatContainer,
			historyContainer,
			settingsContainer,
		);
		let history = this.plugin.settings.promptHistory;

		settingsContainerDiv.setAttr("style", "display: none");
		settingsContainerDiv.addClass("llm-modal-settings-container", "llm-flex");
		chatHistoryContainer.setAttr("style", "display: none");
		chatHistoryContainer.addClass("llm-modal-chat-history-container", "llm-flex");
		lineBreak.className = classNames["modal"]["title-border"];
		chatContainerDiv.addClass("llm-modal-chat-container", "llm-flex");

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
			header,
			() => chatContainer.syncChips()
		);
	}

	onClose() {
		this.chatContainer?.destroy();
		this.chatContainer = null;
	}
}
