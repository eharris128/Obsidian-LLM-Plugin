import LLMPlugin from "main";
import { ButtonComponent, Menu } from "obsidian";
import { ChatContainer } from "./ChatContainer";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { HistoryContainer } from "./HistoryContainer";
import { ViewType } from "Types/types";
import { getViewInfo, setHistoryIndex, setHistoryFilePath } from "utils/utils";
import { SettingsContainer } from "./SettingsContainer";
import { DEFAULT_SETTINGS } from "main";

export class Header {
	viewType: ViewType;
	/** Reference to the inline Chat Details sidebar element in the widget. Set by Widget.ts. */
	detailsSidebarEl: HTMLElement | null = null;

	constructor(private plugin: LLMPlugin, viewType: ViewType) {
		this.viewType = viewType;
	}
	modelEl?: HTMLElement;
	titleEl: HTMLElement | null = null;
	moreOptionsButtonEl: HTMLElement | null = null;
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
		// Show the more-options button only when a chat is loaded
		if (this.moreOptionsButtonEl) {
			if (title) {
				this.moreOptionsButtonEl.show();
			} else {
				this.moreOptionsButtonEl.hide();
			}
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

	/**
	 * Populate a Menu with an "Add to project" submenu item.
	 * Selecting a project sets it as active and refreshes the chip strip.
	 * Can be used from both the FAB chevron menu and the default header more-options menu.
	 */
	private buildAddToProjectMenu(menu: Menu, chatContainer: ChatContainer): void {
		const projects = this.plugin.projectManager?.getProjects() ?? [];
		menu.addItem((item) => {
			item.setTitle("Add to project").setIcon("box");
			const submenu = (item as any).setSubmenu() as Menu;
			const activeId = this.plugin.settings.projectSettings?.activeProjectId;

			submenu.addItem((si) => {
				si.setTitle("No project")
					.setIcon("x-circle")
					.setChecked(!activeId)
					.onClick(() => chatContainer.setActiveProject(null));
			});

			if (projects.length > 0) {
				submenu.addSeparator();
				for (const project of projects) {
					submenu.addItem((si) => {
						si.setTitle(project.name)
							.setIcon("box")
							.setChecked(project.id === activeId)
							.onClick(() => chatContainer.setActiveProject(project.id));
					});
				}
			} else {
				submenu.addItem((si) => {
					si.setTitle("No projects yet").setDisabled(true);
				});
			}
		});
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
						void this.plugin.saveSettings();
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

			if (this.plugin.settings.memorySettings?.enabled) {
				menu.addItem((item) => {
					item.setTitle("Extract and save memories")
						.setIcon("download")
						.onClick(async () => {
							await chatContainer.extractMemories();
						});
				});
			}

			// "Add to project" — only surfaced here when the chat has already started;
			// for new (empty) chats it lives in the + button menu instead.
			if (chatContainer.getMessages().length > 0) {
				this.buildAddToProjectMenu(menu, chatContainer);
			}

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
									void this.plugin.saveSettings();
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
		leftButtonDiv.addClass("llm-left-buttons-div", "llm-left-buttons-div--shrink", "llm-flex");

		// Chat title on the left
		this.titleEl = leftButtonDiv.createEl("span");
		this.titleEl.addClass("llm-chat-title");

		// More options button — immediately to the right of the title; hidden until a chat is loaded
		const moreOptionsButton = new ButtonComponent(leftButtonDiv);
		moreOptionsButton.buttonEl.addClass("clickable-icon");
		moreOptionsButton.setIcon("more-horizontal");
		moreOptionsButton.setTooltip("More options");
		moreOptionsButton.buttonEl.hide();
		this.moreOptionsButtonEl = moreOptionsButton.buttonEl;
		moreOptionsButton.onClick((evt: MouseEvent) => {
			const menu = new Menu();
			// "Add to project" only appears once the chat has messages
			if (chatContainer.getMessages().length > 0) {
				this.buildAddToProjectMenu(menu, chatContainer);
			}

			menu.addSeparator();

			menu.addItem((item) => {
				item.setTitle("Delete chat")
					.setIcon("trash")
					.onClick(() => {
						new ConfirmDeleteModal(this.plugin.app, () => {
							if (this.plugin.settings.chatHistoryEnabled) {
								const { historyFilePath } = getViewInfo(this.plugin, this.viewType);
								if (historyFilePath) {
									this.plugin.chatHistory
										.delete(historyFilePath)
										.catch((e) =>
											console.error("[Header] Failed to delete chat file:", e)
										);
									setHistoryFilePath(this.plugin, this.viewType, null);
								}
							} else {
								const { historyIndex } = getViewInfo(this.plugin, this.viewType);
								if (historyIndex >= 0) {
									this.plugin.settings.promptHistory =
										this.plugin.settings.promptHistory.filter(
											(_, idx) => idx !== historyIndex
										);
									setHistoryIndex(this.plugin, this.viewType);
									this.plugin.settings.currentIndex = -1;
									void this.plugin.saveSettings();
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

		const rightButtonsDiv = titleDiv.createDiv();
		rightButtonsDiv.addClass("llm-right-buttons-div", "llm-flex");

		// Chat Details panel toggle — tab/widget view only (not modal/FAB).
		// Toggles the inline sidebar inside the widget itself (PDF-reader style).
		if (this.viewType === "widget") {
			const chatDetailsButton = new ButtonComponent(rightButtonsDiv);
			chatDetailsButton.buttonEl.addClass("clickable-icon");
			chatDetailsButton.setIcon("message-circle-warning");
			chatDetailsButton.setTooltip("Chat details");

			chatDetailsButton.onClick(() => {
				const sidebar = this.detailsSidebarEl;
				if (!sidebar) return;
				const opening = !sidebar.hasClass("is-open");
				sidebar.toggleClass("is-open", opening);
				chatDetailsButton.buttonEl.toggleClass("is-active", opening);
			});
		}

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
			void this.plugin.saveSettings();
		});

		this.chatHistoryButton.buttonEl.addClass("clickable-icon", "chat-history");
		this.settingsButton.buttonEl.addClass("clickable-icon", "settings-button");
		this.newChatButton.buttonEl.addClass("clickable-icon", "new-chat-button");
		this.chatHistoryButton.setIcon("messages-square");
		this.settingsButton.setIcon("settings-2");
		this.newChatButton.setIcon("plus");
	}
}
