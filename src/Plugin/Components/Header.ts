import LLMPlugin from "main";
import { ButtonComponent, Menu } from "obsidian";
import { ChatContainer } from "./ChatContainer";
import { HistoryContainer } from "./HistoryContainer";
import { ViewType } from "Types/types";
import { getViewInfo, setHistoryIndex } from "utils/utils";
import { SettingsContainer } from "./SettingsContainer";
import { DEFAULT_SETTINGS } from "main";

export class Header {
	viewType: ViewType;
	constructor(private plugin: LLMPlugin, viewType: ViewType) {
		this.viewType = viewType;
	}
	modelEl?: HTMLElement;
	titleEl: HTMLElement | null = null;
	chatHistoryButton?: ButtonComponent;
	newChatButton?: ButtonComponent;
	settingsButton?: ButtonComponent;

	setHeader(_modelName: string) {
		// Model name is now shown in the chat input toolbar dropdown
	}

	setTitle(title: string) {
		if (this.titleEl) {
			this.titleEl.textContent = title || "";
		}
	}

	showTitle() {
		this.titleEl?.show();
	}

	hideTitle() {
		this.titleEl?.hide();
	}

	resetHistoryButton() {
		this.chatHistoryButton?.buttonEl.removeClass("is-active");
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
		this.chatHistoryButton?.setDisabled(true);
		this.newChatButton?.setDisabled(true);
		this.settingsButton?.setDisabled(true);
	}

	enableButtons() {
		this.chatHistoryButton?.setDisabled(false);
		this.newChatButton?.setDisabled(false);
		this.settingsButton?.setDisabled(false);
	}

	generateHeader(
		parentElement: Element,
		chatContainerDiv: HTMLElement,
		chatHistoryContainerDiv: HTMLElement,
		settingsContainerDiv: HTMLElement,
		chatContainer: ChatContainer,
		historyContainer: HistoryContainer,
		settingsContainer: SettingsContainer,
		closeCallback?: () => void
	) {
		const titleDiv = createDiv();
		titleDiv.addClass("llm-title-div", "llm-flex");

		if (this.viewType === "floating-action-button") {
			this.generateFABHeader(
				titleDiv,
				chatContainerDiv,
				chatHistoryContainerDiv,
				settingsContainerDiv,
				chatContainer,
				historyContainer,
				settingsContainer,
				closeCallback
			);
		} else {
			this.generateDefaultHeader(
				titleDiv,
				chatContainerDiv,
				chatHistoryContainerDiv,
				settingsContainerDiv,
				chatContainer,
				historyContainer,
				settingsContainer
			);
		}

		parentElement.prepend(titleDiv);
	}

	private generateFABHeader(
		titleDiv: HTMLElement,
		chatContainerDiv: HTMLElement,
		chatHistoryContainerDiv: HTMLElement,
		settingsContainerDiv: HTMLElement,
		chatContainer: ChatContainer,
		historyContainer: HistoryContainer,
		settingsContainer: SettingsContainer,
		closeCallback?: () => void
	) {
		const leftDiv = titleDiv.createDiv();
		leftDiv.addClass("llm-left-buttons-div", "llm-flex");

		// Chat title text
		this.titleEl = leftDiv.createEl("span");
		this.titleEl.addClass("llm-chat-title");

		const rightButtonsDiv = titleDiv.createDiv();
		rightButtonsDiv.addClass("llm-right-buttons-div", "llm-flex");

		// Chevron dropdown button
		const chevronButton = new ButtonComponent(rightButtonsDiv);
		chevronButton.buttonEl.addClass("clickable-icon");
		chevronButton.setIcon("chevron-down");
		chevronButton.setTooltip("More options");
		chevronButton.onClick((evt: MouseEvent) => {
			const menu = new Menu();

			menu.addItem((item) => {
				item.setTitle("New chat")
					.setIcon("plus")
					.onClick(() => {
						const { modelName } = getViewInfo(this.plugin, this.viewType);
						this.setTitle("");
						this.showTitle();
						chatContainerDiv.show();
						settingsContainerDiv.hide();
						chatHistoryContainerDiv.hide();
						chatContainer.newChat();
						chatContainer.resetMessages();
						setHistoryIndex(this.plugin, this.viewType);
						this.plugin.settings.currentIndex = -1;
						this.plugin.saveSettings();
					});
			});

			menu.addItem((item) => {
				item.setTitle("Open in sidebar")
					.setIcon("panel-right")
					.onClick(() => {
						const historyIndex = this.plugin.settings.fabSettings.historyIndex;
						this.plugin.pendingWidgetHistoryIndex = historyIndex;
						this.plugin.activateSidebar();
						closeCallback?.();
					});
			});

			menu.addItem((item) => {
				item.setTitle("Open in tab")
					.setIcon("layout-dashboard")
					.onClick(() => {
						const historyIndex = this.plugin.settings.fabSettings.historyIndex;
						this.plugin.pendingWidgetHistoryIndex = historyIndex;
						this.plugin.activateTab();
						closeCallback?.();
					});
			});

			menu.addSeparator();

			menu.addItem((item) => {
				item.setTitle("Delete chat")
					.setIcon("trash")
					.onClick(() => {
						const historyIndex = this.plugin.settings.fabSettings.historyIndex;
						if (historyIndex >= 0) {
							this.plugin.settings.promptHistory =
								this.plugin.settings.promptHistory.filter(
									(_, idx) => idx !== historyIndex
								);
							this.plugin.settings.fabSettings.historyIndex =
								DEFAULT_SETTINGS.fabSettings.historyIndex;
							this.plugin.settings.currentIndex = -1;
							this.plugin.saveSettings();
						}
						this.setTitle("");
						this.showTitle();
						chatContainerDiv.show();
						settingsContainerDiv.hide();
						chatHistoryContainerDiv.hide();
						chatContainer.newChat();
						chatContainer.resetMessages();
					});
			});

			menu.showAtMouseEvent(evt);
		});

		// Chat history button
		this.chatHistoryButton = new ButtonComponent(rightButtonsDiv);
		this.chatHistoryButton.setTooltip("Chats");
		this.chatHistoryButton.buttonEl.addClass("clickable-icon", "chat-history");
		this.chatHistoryButton.setIcon("messages-square");
		this.chatHistoryButton.onClick(() => {
			historyContainer.resetHistory(chatHistoryContainerDiv);
			historyContainer.generateHistoryContainer(
				chatHistoryContainerDiv,
				this.plugin.settings.promptHistory,
				chatContainerDiv,
				chatContainer,
				this
			);
			this.clickHandler(this.chatHistoryButton!, [this.settingsButton!]);
			if (!chatHistoryContainerDiv.isShown()) {
				chatHistoryContainerDiv.show();
				settingsContainerDiv.hide();
				chatContainerDiv.hide();
				this.hideTitle();
			} else {
				chatContainerDiv.show();
				chatHistoryContainerDiv.hide();
				this.showTitle();
			}
		});

		// Settings button
		this.settingsButton = new ButtonComponent(rightButtonsDiv);
		this.settingsButton.setTooltip("Chat settings");
		this.settingsButton.onClick(() => {
			settingsContainer.resetSettings(settingsContainerDiv);
			settingsContainer.generateSettingsContainer(
				settingsContainerDiv,
				this
			);
			this.clickHandler(this.settingsButton!, [this.chatHistoryButton!]);
			if (!settingsContainerDiv.isShown()) {
				settingsContainerDiv.show();
				chatContainerDiv.hide();
				chatHistoryContainerDiv.hide();
				this.hideTitle();
			} else {
				chatContainerDiv.show();
				settingsContainerDiv.hide();
				this.showTitle();
			}
		});
		this.settingsButton.buttonEl.addClass("clickable-icon", "settings-button");
		this.settingsButton.setIcon("settings-2");

		// Close (X) button
		if (closeCallback) {
			const closeButton = new ButtonComponent(rightButtonsDiv);
			closeButton.buttonEl.addClass("clickable-icon");
			closeButton.setIcon("x");
			closeButton.setTooltip("Close");
			closeButton.onClick(closeCallback);
		}
	}

	private generateDefaultHeader(
		titleDiv: HTMLElement,
		chatContainerDiv: HTMLElement,
		chatHistoryContainerDiv: HTMLElement,
		settingsContainerDiv: HTMLElement,
		chatContainer: ChatContainer,
		historyContainer: HistoryContainer,
		settingsContainer: SettingsContainer
	) {
		const leftButtonDiv = titleDiv.createDiv();
		leftButtonDiv.addClass("llm-left-buttons-div", "llm-flex");

		// Chat title on the left
		this.titleEl = leftButtonDiv.createEl("span");
		this.titleEl.addClass("llm-chat-title");

		const rightButtonsDiv = titleDiv.createDiv();
		rightButtonsDiv.addClass("llm-right-buttons-div", "llm-flex");

		// Right buttons in order: chat history → settings → new chat
		this.chatHistoryButton = new ButtonComponent(rightButtonsDiv);
		this.settingsButton = new ButtonComponent(rightButtonsDiv);
		this.newChatButton = new ButtonComponent(rightButtonsDiv);

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
			this.clickHandler(this.chatHistoryButton!, [
				this.settingsButton!,
			]);
			if (!chatHistoryContainerDiv.isShown()) {
				chatHistoryContainerDiv.show();
				settingsContainerDiv.hide();
				chatContainerDiv.hide();
				this.hideTitle();
			} else {
				chatContainerDiv.show();
				chatHistoryContainerDiv.hide();
				this.showTitle();
			}
		});

		this.settingsButton.setTooltip("Chat settings");
		this.settingsButton.onClick(() => {
			settingsContainer.resetSettings(settingsContainerDiv);
			settingsContainer.generateSettingsContainer(
				settingsContainerDiv,
				this
			);
			this.clickHandler(this.settingsButton!, [
				this.chatHistoryButton!,
			]);
			if (!settingsContainerDiv.isShown()) {
				settingsContainerDiv.show();
				chatContainerDiv.hide();
				chatHistoryContainerDiv.hide();
				this.hideTitle();
			} else {
				chatContainerDiv.show();
				settingsContainerDiv.hide();
				this.showTitle();
			}
		});

		this.newChatButton.setTooltip("New chat");
		this.newChatButton.onClick(() => {
			const { modelName } = getViewInfo(this.plugin, this.viewType);
			this.clickHandler(this.newChatButton!, [
				this.settingsButton!,
				this.chatHistoryButton!,
			]);
			this.setHeader(modelName);
			this.showTitle();
			chatContainerDiv.show();
			settingsContainerDiv.hide();
			chatHistoryContainerDiv.hide();
			chatContainer.newChat();
			chatContainer.resetMessages();
			setHistoryIndex(this.plugin, this.viewType);
			this.plugin.settings.currentIndex = -1;
			this.plugin.saveSettings();
		});

		this.chatHistoryButton.buttonEl.addClass("clickable-icon", "chat-history");
		this.settingsButton.buttonEl.addClass("clickable-icon", "settings-button");
		this.newChatButton.buttonEl.addClass("clickable-icon", "new-chat-button");
		this.chatHistoryButton.setIcon("messages-square");
		this.settingsButton.setIcon("settings-2");
		this.newChatButton.setIcon("plus");
	}
}
