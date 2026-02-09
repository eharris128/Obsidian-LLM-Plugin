import LLMPlugin from "main";
import { ButtonComponent } from "obsidian";
import { ChatContainer } from "./ChatContainer";
import { HistoryContainer } from "./HistoryContainer";
import { ViewType } from "Types/types";
import { getViewInfo, setHistoryIndex } from "utils/utils";
import { SettingsContainer } from "./SettingsContainer";
import { AssistantsContainer } from "./AssistantsContainer";

export class Header {
	viewType: ViewType;
	constructor(private plugin: LLMPlugin, viewType: ViewType) {
		this.viewType = viewType;
	}
	modelEl: HTMLElement;
	titleEl?: HTMLElement;
	chatHistoryButton: ButtonComponent;
	newChatButton: ButtonComponent;
	settingsButton: ButtonComponent;
	assistantsButton: ButtonComponent;

	setHeader(modelName: string, title?: string) {
		if (title) {
			this.titleEl!.textContent = title;
		}
		this.modelEl.textContent = modelName;
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
		this.assistantsButton.setDisabled(true);
	}

	enableButtons() {
		this.chatHistoryButton.setDisabled(false);
		this.newChatButton.setDisabled(false);
		this.settingsButton.setDisabled(false);
		this.assistantsButton.setDisabled(false);
	}

	generateHeader(
		parentElement: Element,
		chatContainerDiv: HTMLElement,
		chatHistoryContainerDiv: HTMLElement,
		settingsContainerDiv: HTMLElement,
		assistantContainerDiv: HTMLElement,
		chatContainer: ChatContainer,
		historyContainer: HistoryContainer,
		settingsContainer: SettingsContainer,
		assistantsContainer: AssistantsContainer
	) {
		const { modelName } = getViewInfo(this.plugin, this.viewType);
		const titleDiv = createDiv();
		const leftButtonDiv = titleDiv.createDiv();
		const titleContainer = titleDiv.createDiv();
		this.titleEl = titleContainer.createDiv();
		this.titleEl.addClass(`${this.viewType}-llm-title`);
		const rightButtonsDiv = titleDiv.createDiv();

		titleDiv.addClass("llm-title-div", "llm-flex");
		this.titleEl.textContent = "LLM";
		this.modelEl = titleContainer.createDiv();
		this.modelEl.addClass("llm-model-name");
		this.modelEl.textContent = modelName;

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
				this.assistantsButton,
			]);
			if (!chatHistoryContainerDiv.isShown()) {
				chatHistoryContainerDiv.show();
				settingsContainerDiv.hide();
				chatContainerDiv.hide();
				assistantContainerDiv.hide();
			} else {
				chatContainerDiv.show();
				chatHistoryContainerDiv.hide();
			}
		});

		this.assistantsButton = new ButtonComponent(rightButtonsDiv);
		this.assistantsButton.setTooltip("Assistants");
		assistantsContainer.generateAssistantsContainer(assistantContainerDiv);
		this.assistantsButton.onClick(() => {
			this.clickHandler(this.assistantsButton, [
				this.settingsButton,
				this.chatHistoryButton,
			]);
			if (!assistantContainerDiv.isShown()) {
				assistantContainerDiv.show();
				settingsContainerDiv.hide();
				chatContainerDiv.hide();
				chatHistoryContainerDiv.hide();
			} else {
				chatContainerDiv.show();
				assistantContainerDiv.hide();
			}
		});

		if (this.viewType === "floating-action-button") {
			this.newChatButton = new ButtonComponent(leftButtonDiv);
			this.settingsButton = new ButtonComponent(rightButtonsDiv);
		} else {
			this.newChatButton = new ButtonComponent(rightButtonsDiv);
			this.settingsButton = new ButtonComponent(leftButtonDiv);
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
				this.assistantsButton,
			]);
			if (!settingsContainerDiv.isShown()) {
				settingsContainerDiv.show();
				chatContainerDiv.hide();
				chatHistoryContainerDiv.hide();
				assistantContainerDiv.hide();
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
				this.assistantsButton,
			]);
			this.setHeader(modelName, "New chat");
			chatContainerDiv.show();
			settingsContainerDiv.hide();
			chatHistoryContainerDiv.hide();
			assistantContainerDiv.hide();
			chatContainer.newChat();
			chatContainer.resetMessages();
			setHistoryIndex(this.plugin, this.viewType);
		});

		leftButtonDiv.addClass("llm-left-buttons-div", "llm-flex");
		rightButtonsDiv.addClass("llm-right-buttons-div", "llm-flex");
		titleContainer.addClass("llm-title", "llm-flex");
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
		this.assistantsButton.buttonEl.addClass("clickable-icon", "assistants");
		this.chatHistoryButton.setIcon("menu");
		this.settingsButton.setIcon("sliders-horizontal");
		this.newChatButton.setIcon("plus");
		this.assistantsButton.setIcon("bot");

		parentElement.prepend(titleDiv);
	}
}
