import LLMPlugin from "main";
import { ButtonComponent, Menu, setIcon } from "obsidian";
import { ChatContainer } from "./ChatContainer";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { HistoryContainer } from "./HistoryContainer";
import { ViewType } from "Types/types";
import { getViewInfo, setHistoryIndex, setHistoryFilePath } from "utils/utils";
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
	/** Reference to the project switcher pill element so it can be updated. */
	private projectSwitcherEl: HTMLElement | null = null;

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
			toggles.forEach((toggle) => {
				toggle.buttonEl.removeClass("is-active");
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
						const historyFilePath = this.plugin.settings.fabSettings.historyFilePath;
						this.plugin.pendingWidgetHistoryIndex = historyIndex;
						this.plugin.pendingWidgetFilePath = historyFilePath;
						this.plugin.activateSidebar();
						closeCallback?.();
					});
			});

			menu.addItem((item) => {
				item.setTitle("Open in tab")
					.setIcon("layout-dashboard")
					.onClick(() => {
						const historyIndex = this.plugin.settings.fabSettings.historyIndex;
						const historyFilePath = this.plugin.settings.fabSettings.historyFilePath;
						this.plugin.pendingWidgetHistoryIndex = historyIndex;
						this.plugin.pendingWidgetFilePath = historyFilePath;
						this.plugin.activateTab();
						closeCallback?.();
					});
			});

			menu.addSeparator();

			menu.addItem((item) => {
				item.setTitle("Delete chat")
					.setIcon("trash")
					.onClick(() => {
						new ConfirmDeleteModal(this.plugin.app, () => {
							if (this.plugin.settings.chatHistoryEnabled) {
								// File-based history: delete the markdown file from the vault
								const filePath = this.plugin.settings.fabSettings.historyFilePath;
								if (filePath) {
									this.plugin.chatHistory
										.delete(filePath)
										.catch((e) =>
											console.error("[Header] Failed to delete chat file:", e)
										);
									setHistoryFilePath(this.plugin, this.viewType, null);
								}
							} else {
								// Legacy array-based history: remove from promptHistory array
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
							}
							this.setTitle("");
							this.showTitle();
							chatContainerDiv.show();
							settingsContainerDiv.hide();
							chatHistoryContainerDiv.hide();
							chatContainer.newChat();
							chatContainer.resetMessages();
						}).open();
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
			settingsContainer.generateSettingsContainer(settingsContainerDiv);
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

		// Project switcher — on the left, after the title
		this.buildProjectSwitcher(
			leftDiv,
			chatContainerDiv,
			settingsContainerDiv,
			chatHistoryContainerDiv,
			chatContainer
		);
	}

	/**
	 * Build the project switcher pill and append it to the given container.
	 * Clicking opens a menu to switch projects (or clear the active project).
	 * Switching auto-starts a new chat.
	 */
	private buildProjectSwitcher(
		container: HTMLElement,
		chatContainerDiv: HTMLElement,
		settingsContainerDiv: HTMLElement,
		chatHistoryContainerDiv: HTMLElement,
		chatContainer: ChatContainer
	): void {
		this.projectSwitcherEl = container.createEl("button");
		this.projectSwitcherEl.addClass("llm-project-switcher");
		this.updateProjectSwitcher();

		this.projectSwitcherEl.addEventListener("click", (evt: MouseEvent) => {
			const menu = new Menu();
			const projects = this.plugin.projectManager?.getProjects() ?? [];

			// "No project" option
			const activeId = this.plugin.settings.projectSettings?.activeProjectId;
			menu.addItem((item) => {
				item
					.setTitle("No project")
					.setIcon("x-circle")
					.setChecked(!activeId)
					.onClick(() => {
						this.plugin.settings.projectSettings = {
							...this.plugin.settings.projectSettings,
							activeProjectId: null,
						};
						this.plugin.saveSettings();
						this.updateProjectSwitcher();
						// Auto-start new chat
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

			if (projects.length > 0) {
				menu.addSeparator();
				for (const project of projects) {
					menu.addItem((item) => {
						item
							.setTitle(project.name)
							.setIcon("folder-open")
							.setChecked(activeId === project.id)
							.onClick(() => {
								this.plugin.settings.projectSettings = {
									...this.plugin.settings.projectSettings,
									activeProjectId: project.id,
								};
								this.plugin.saveSettings();
								this.updateProjectSwitcher();
								// Auto-start new chat under the new project
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
				}
			}

			if (projects.length === 0) {
				menu.addItem((item) => {
					item
						.setTitle("No projects yet")
						.setDisabled(true);
				});
			}

			menu.showAtMouseEvent(evt);
		});
	}

	/** Update the project switcher pill text/state to reflect the current active project. */
	updateProjectSwitcher(): void {
		if (!this.projectSwitcherEl) return;
		const activeId = this.plugin.settings.projectSettings?.activeProjectId;
		const project = activeId
			? this.plugin.projectManager?.getProject(activeId)
			: null;

		this.projectSwitcherEl.empty();

		const iconEl = this.projectSwitcherEl.createEl("span", { cls: "llm-project-switcher-icon" });
		setIcon(iconEl, project ? "folder-open" : "folder");

		this.projectSwitcherEl.createEl("span", {
			text: project ? project.name : "No project",
			cls: "llm-project-switcher-label",
		});

		const chevronEl = this.projectSwitcherEl.createEl("span", { cls: "llm-project-switcher-chevron" });
		setIcon(chevronEl, "chevron-down");

		this.projectSwitcherEl.toggleClass("llm-project-switcher--active", !!project);
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

		this.settingsButton.setTooltip("Chat settings");
		this.settingsButton.onClick(() => {
			settingsContainer.resetSettings(settingsContainerDiv);
			settingsContainer.generateSettingsContainer(settingsContainerDiv);
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

		this.newChatButton.setTooltip("New chat");
		this.newChatButton.onClick(() => {
			const { modelName } = getViewInfo(this.plugin, this.viewType);
			this.clickHandler(this.newChatButton!, [
				this.settingsButton!,
				this.chatHistoryButton!,
			]);
			this.setHeader(modelName);
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

		this.chatHistoryButton.buttonEl.addClass("clickable-icon", "chat-history");
		this.settingsButton.buttonEl.addClass("clickable-icon", "settings-button");
		this.newChatButton.buttonEl.addClass("clickable-icon", "new-chat-button");
		this.chatHistoryButton.setIcon("messages-square");
		this.settingsButton.setIcon("settings-2");
		this.newChatButton.setIcon("plus");

		// Project switcher — shown on the left, after the title
		this.buildProjectSwitcher(
			leftButtonDiv,
			chatContainerDiv,
			settingsContainerDiv,
			chatHistoryContainerDiv,
			chatContainer
		);

	}
}
