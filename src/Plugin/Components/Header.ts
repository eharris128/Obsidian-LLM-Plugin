import LLMPlugin from "main";
import { ButtonComponent } from "obsidian";
import { ChatContainer } from "./ChatContainer";
import { HistoryContainer } from "./HistoryContainer";
import { ViewType } from "Types/types";
import { getViewInfo, setHistoryIndex } from "utils/utils";
import { SettingsContainer } from "./SettingsContainer";

export class Header {
	viewType: ViewType;
	constructor(private plugin: LLMPlugin, viewType: ViewType) {
		this.viewType = viewType;
	}
	modelEl?: HTMLElement;
	chatHistoryButton: ButtonComponent;
	newChatButton: ButtonComponent;
	settingsButton: ButtonComponent;

	setHeader(_modelName: string) {
		// Model name is now shown in the chat input toolbar dropdown
	}

	resetHistoryButton() {
		this.chatHistoryButton.buttonEl.removeClass("is-active");
	}

	clickHandler(button: ButtonComponent, toggles: ButtonComponent[]) {
		if (button.buttonEl.classList.contains("is-active")) {
			button.buttonEl.removeClass("is-active");
		} else {
			if (!button.buttonEl.classList.contains("new-chat-button")) {
				button.buttonEl.addClass("is-active");
			}
			toggles.map((el) => {
				el.buttonEl.removeClass("is-active");
			});
		}
	}

	disableButtons() {
		this.chatHistoryButton.setDisabled(true);
		this.newChatButton.setDisabled(true);
		this.settingsButton.setDisabled(true);
	}

	enableButtons() {
		this.chatHistoryButton.setDisabled(false);
		this.newChatButton.setDisabled(false);
		this.settingsButton.setDisabled(false);
	}

	generateHeader(
		parentElement: Element,
		chatContainerDiv: HTMLElement,
		chatHistoryContainerDiv: HTMLElement,
		settingsContainerDiv: HTMLElement,
		chatContainer: ChatContainer,
		historyContainer: HistoryContainer,
		settingsContainer: SettingsContainer
	) {
		const titleDiv = createDiv();
		const leftButtonDiv = titleDiv.createDiv();
		const rightButtonsDiv = titleDiv.createDiv();

		titleDiv.addClass("llm-title-div", "llm-flex");

		this.chatHistoryButton = new ButtonComponent(leftButtonDiv);
		this.chatHistoryButton.setTooltip("Chats");
		this.chatHistoryButton.onClick(() => {
			historyContainer.resetHistory(chatHistoryContainerDiv);
			historyContainer.generateHistoryContainer(
				chatHistoryContainerDiv,
				this.plugin.settings.promptHistory,
				chatContainerDiv,
				chatContainer,
				this
			);
			this.clickHandler(this.chatHistoryButton, [
				this.settingsButton,
			]);
			if (!chatHistoryContainerDiv.isShown()) {
				chatHistoryContainerDiv.show();
				settingsContainerDiv.hide();
				chatContainerDiv.hide();
			} else {
				chatContainerDiv.show();
				chatHistoryContainerDiv.hide();
			}
		});

		if (this.viewType === "floating-action-button") {
			this.newChatButton = new ButtonComponent(leftButtonDiv);
			this.settingsButton = new ButtonComponent(rightButtonsDiv);
		} else {
			this.newChatButton = new ButtonComponent(rightButtonsDiv);
			this.settingsButton = new ButtonComponent(rightButtonsDiv);
		}

		this.settingsButton.setTooltip("Chat settings");
		this.settingsButton.onClick(() => {
			settingsContainer.resetSettings(settingsContainerDiv);
			settingsContainer.generateSettingsContainer(
				settingsContainerDiv,
				this
			);
			this.clickHandler(this.settingsButton, [
				this.chatHistoryButton,
			]);
			if (!settingsContainerDiv.isShown()) {
				settingsContainerDiv.show();
				chatContainerDiv.hide();
				chatHistoryContainerDiv.hide();
			} else {
				chatContainerDiv.show();
				settingsContainerDiv.hide();
			}
		});

		this.newChatButton.setTooltip("New chat");
		this.newChatButton.onClick(() => {
			const { modelName } = getViewInfo(this.plugin, this.viewType);
			this.clickHandler(this.newChatButton, [
				this.settingsButton,
				this.chatHistoryButton,
			]);
			this.setHeader(modelName);
			chatContainerDiv.show();
			settingsContainerDiv.hide();
			chatHistoryContainerDiv.hide();
			chatContainer.newChat();
			chatContainer.resetMessages();
			setHistoryIndex(this.plugin, this.viewType);
			this.plugin.settings.currentIndex = -1;
			this.plugin.saveSettings();
		});

		leftButtonDiv.addClass("llm-left-buttons-div", "llm-flex");
		rightButtonsDiv.addClass("llm-right-buttons-div", "llm-flex");
		this.chatHistoryButton.buttonEl.addClass(
			"clickable-icon",
			"chat-history"
		);
		this.settingsButton.buttonEl.addClass(
			"clickable-icon",
			"settings-button"
		);
		this.newChatButton.buttonEl.addClass(
			"clickable-icon",
			"new-chat-button"
		);
		this.chatHistoryButton.setIcon("menu");
		this.settingsButton.setIcon("sliders-horizontal");
		this.newChatButton.setIcon("plus");

		parentElement.prepend(titleDiv);
	}
}
