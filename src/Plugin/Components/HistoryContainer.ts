import { HistoryItem, ViewType } from "Types/types";
import LLMPlugin, { DEFAULT_SETTINGS } from "main";
import { ButtonComponent, Notice, TFile } from "obsidian";
import { ConfirmDeleteModal } from "./ConfirmDeleteModal";
import { ChatContainer } from "./ChatContainer";
import { Header } from "./Header";
import { models } from "utils/models";
import { getSettingType, setHistoryFilePath } from "utils/utils";
import logo from "assets/LLMgal.svg";

export class HistoryContainer {
	viewType: ViewType;
	model: string;
	modelName: string;
	modelType: string;
	historyIndex: number;
	constructor(private plugin: LLMPlugin, viewType: ViewType) {
		this.viewType = viewType;
	}

	getChatContainerClassPrefix() {
		if (this.viewType === "floating-action-button") {
			return "fab";
		} else if (this.viewType === "widget") {
			return this.viewType;
		} else if (this.viewType === "modal") {
			return this.viewType;
		}
	}

	displayNoHistoryView(parentElement: HTMLElement) {
		parentElement.addClass("llm-justify-content-center");

		const llmGal = parentElement.createDiv();
		llmGal.addClass("llm-icon-wrapper");
		llmGal.addClass("llm-icon-new-history");

		// Parse SVG string to DOM element
		const parser = new DOMParser();
		const svgDoc = parser.parseFromString(logo, "image/svg+xml");
		const svgElement = svgDoc.documentElement;

		// Append the SVG element
		llmGal.appendChild(svgElement);

		const cta = llmGal.createEl("div", {
			attr: {
				class: "empty-history-cta llm-font-size-medium llm-justify-content-center",
			},
			text: "Looking kind of empty. Start chatting and conversations will appear here.",
		});
		cta.addClass("text-align-center");

		const createChatButton = new ButtonComponent(cta);
		createChatButton.setButtonText("New chat");
		createChatButton.setClass("llm-empty-history-button");
		createChatButton.setClass("mod-cta");

		createChatButton.onClick(() => {
			parentElement.hide();
			const activeHistoryButton = document.querySelector(
				".chat-history.is-active"
			);
			activeHistoryButton?.classList.remove("is-active");

			const prefix = this.getChatContainerClassPrefix();
			const chatContainer = document.querySelector(
				`[class*="${prefix}-chat-container"]`
			) as HTMLElement;

			chatContainer.show();
			parentElement.classList.remove("llm-justify-content-center");
		});
	}

	generateHistoryContainer(
		parentElement: HTMLElement,
		history: HistoryItem[],
		containerToShow: HTMLElement,
		chat: ChatContainer,
		Header: Header
	) {
		if (this.plugin.settings.chatHistoryEnabled) {
			// Async file-based path — load files then render
			this.plugin.chatHistory
				.list()
				.then((files) => {
					this.resetHistory(parentElement);
					if (!files.length) {
						this.displayNoHistoryView(parentElement);
						return;
					}
					this.generateFileHistoryContainer(
						parentElement,
						files,
						containerToShow,
						chat,
						Header
					);
				})
				.catch((e) => {
					console.error("[HistoryContainer] Failed to list chat files:", e);
					this.displayNoHistoryView(parentElement);
				});
			return;
		}

		// ── Legacy array-based path ───────────────────────────────────────────
		if (!history.length) {
			this.displayNoHistoryView(parentElement);
			return;
		}

		// Remove centering classes that displayNoHistoryView may have added when
		// the history was empty — now that we have items they must not apply.
		parentElement.removeClass("llm-justify-content-center");

		const settingType = getSettingType(this.viewType);
		this.model = this.plugin.settings[settingType].model;
		this.modelName = this.plugin.settings[settingType].modelName;
		this.modelType = this.plugin.settings[settingType].modelType;
		this.modelType = this.plugin.settings[settingType].modelType;
		this.historyIndex = this.plugin.settings[settingType].historyIndex;

		const eventListener = () => {
			chat.resetChat();
			parentElement.hide();
			containerToShow.show();
			chat.setMessages(true);
			const messages = chat.getMessages();
			chat.generateIMLikeMessages(messages);
			containerToShow.querySelector(".messages-div")?.scroll(0, 9999);
			const index = this.historyIndex;
			this.plugin.settings.currentIndex = index;
			const modelName =
				this.plugin.settings.promptHistory[index].modelName;
			const model = this.plugin.settings.promptHistory[index].model;
			this.plugin.settings[settingType].modelName = modelName;
			this.plugin.settings[settingType].model =
				models[modelName].model;
			this.plugin.settings[settingType].modelType =
				models[modelName].type;
			this.plugin.settings[settingType].modelEndpoint =
				models[modelName].endpoint;
			this.plugin.settings[settingType].endpointURL =
				models[modelName].url;
			this.plugin.saveSettings();
			Header.setHeader(modelName);
			Header.resetHistoryButton();
			// Sync the FAB header title with the loaded conversation's first message.
			const loadedItem = this.plugin.settings.promptHistory[index];
			const displayTitle = loadedItem?.prompt || loadedItem?.messages[0]?.content || "";
			Header.setTitle(displayTitle);
			Header.showTitle();
		};

		eventListener.bind(this);

		const disableHistory = (
			collection: HTMLCollection,
			index: number,
			enabled: boolean
		) => {
			for (let i = 0; i < collection.length; i++) {
				if (i !== index && !enabled) {
					collection.item(i)?.addClass("llm-no-pointer");
				} else {
					collection.item(i)?.removeClass("llm-no-pointer");
				}
			}
		};
		const toggleContentEditable = (
			element: HTMLElement,
			toggle: boolean
		) => {
			element.setAttr("contenteditable", toggle);
		};

		history.map((historyItem: HistoryItem, index: number) => {
			const item = parentElement.createDiv();
			const text = item.createEl("p");
			const displayHTML =
				historyItem?.prompt || historyItem?.messages[0]?.content;
			text.textContent = displayHTML;
			const buttonsDiv = item.createDiv();
			buttonsDiv.addClass("history-buttons-div", "llm-flex");
			const editPrompt = new ButtonComponent(buttonsDiv);
			const savePrompt = new ButtonComponent(buttonsDiv);
			const deleteHistory = new ButtonComponent(buttonsDiv);
			savePrompt.buttonEl.setAttr(
				"style",
				"display: none; visibility: hidden"
			);
			editPrompt.buttonEl.setAttr("style", "visibility: hidden");
			deleteHistory.buttonEl.setAttr("style", "visibility: hidden");

			item.className = "setting-item";
			item.setAttr("contenteditable", "false");
			item.addClass("llm-history-item", "llm-flex");
			editPrompt.buttonEl.addClass("edit-prompt-button");
			savePrompt.buttonEl.addClass("save-prompt-button");
			editPrompt.setIcon("pencil");
			savePrompt.setIcon("save");
			deleteHistory.buttonEl.addClass(
				"llm-delete-history-button",
				"mod-warning"
			);
			deleteHistory.buttonEl.id = "llm-delete-history-button";
			item.addEventListener("click", () => {
				this.plugin.settings[settingType].historyIndex = index;
				this.historyIndex = index;
				this.plugin.saveSettings();
			});

			item.addEventListener("mouseenter", () => {
				if (
					text.contentEditable == "false" ||
					text.contentEditable == "inherit"
				) {
					editPrompt.buttonEl.setAttr("style", "visibility: visible");
					deleteHistory.buttonEl.setAttr(
						"style",
						"visibility: visible"
					);
				}
			});
			item.addEventListener("mouseleave", () => {
				if (
					text.contentEditable == "false" ||
					text.contentEditable == "inherit"
				) {
					editPrompt.buttonEl.setAttr("style", "visibility: hidden");
					deleteHistory.buttonEl.setAttr(
						"style",
						"visibility: hidden"
					);
				}
			});
			item.addEventListener("click", eventListener);

			deleteHistory.setIcon("trash");
			deleteHistory.onClick((e: MouseEvent) => {
				e.stopPropagation();
				new ConfirmDeleteModal(this.plugin.app, () => {
					this.resetHistory(parentElement);
					let updatedHistory = this.plugin.settings.promptHistory.filter(
						(item, idx) => idx !== index
					);
					this.plugin.settings.promptHistory = updatedHistory;
					this.plugin.saveSettings();
					this.generateHistoryContainer(
						parentElement,
						this.plugin.settings.promptHistory,
						containerToShow,
						chat,
						Header
					);
					chat.resetChat();
					chat.resetMessages();
					Header.setHeader(this.modelName);
					this.plugin.settings[settingType].historyIndex =
						DEFAULT_SETTINGS[settingType].historyIndex;
					this.plugin.saveSettings();
				}).open();
			});

			editPrompt.onClick((e: MouseEvent) => {
				e.stopPropagation();
				item.removeEventListener("click", eventListener);
				toggleContentEditable(text, true);
				text.focus();
				editPrompt.buttonEl.setAttr("style", "display: none");
				savePrompt.buttonEl.setAttr("style", "display: inline-flex");
				disableHistory(parentElement.children, index, false);
			});

			savePrompt.onClick((e: MouseEvent) => {
				e.stopPropagation();
				if (item.textContent) {
					this.plugin.settings.promptHistory[index].prompt =
						item.textContent;
					this.plugin.saveSettings();
				} else {
					new Notice("Prompt length must be greater than 0");
					return;
				}
				item.addEventListener("click", eventListener);
				toggleContentEditable(text, false);
				editPrompt.buttonEl.setAttr("style", "display: inline-flex");
				savePrompt.buttonEl.setAttr("style", "display: none");
				disableHistory(parentElement.children, index, true);
			});
		});
	}

	/**
	 * Render history items sourced from markdown files in the vault.
	 * Titles come from the `title` frontmatter field via the metadata cache,
	 * falling back to the filename if the cache hasn't built yet.
	 */
	private generateFileHistoryContainer(
		parentElement: HTMLElement,
		files: TFile[],
		containerToShow: HTMLElement,
		chat: ChatContainer,
		header: Header
	) {
		parentElement.removeClass("llm-justify-content-center");
		const settingType = getSettingType(this.viewType);

		const toggleContentEditable = (el: HTMLElement, toggle: boolean) => {
			el.setAttr("contenteditable", toggle);
		};

		const disableOtherItems = (
			collection: HTMLCollection,
			activeIndex: number,
			disable: boolean
		) => {
			for (let i = 0; i < collection.length; i++) {
				if (i !== activeIndex && disable) {
					collection.item(i)?.addClass("llm-no-pointer");
				} else {
					collection.item(i)?.removeClass("llm-no-pointer");
				}
			}
		};

		files.forEach((file, index) => {
			// Prefer the cached frontmatter title; fall back to the filename stem.
			const cachedTitle =
				this.plugin.app.metadataCache.getFileCache(file)?.frontmatter
					?.title;
			const displayTitle = cachedTitle ?? file.basename;

			const item = parentElement.createDiv();
			item.className = "setting-item";
			item.setAttr("contenteditable", "false");
			item.addClass("llm-history-item", "llm-flex");

			const text = item.createEl("p");
			text.textContent = displayTitle;

			const buttonsDiv = item.createDiv();
			buttonsDiv.addClass("history-buttons-div", "llm-flex");

			const editBtn = new ButtonComponent(buttonsDiv);
			const saveBtn = new ButtonComponent(buttonsDiv);
			const deleteBtn = new ButtonComponent(buttonsDiv);

			editBtn.setIcon("pencil");
			saveBtn.setIcon("save");
			deleteBtn.setIcon("trash");

			editBtn.buttonEl.addClass("edit-prompt-button");
			saveBtn.buttonEl.addClass("save-prompt-button");
			deleteBtn.buttonEl.addClass("llm-delete-history-button", "mod-warning");

			saveBtn.buttonEl.setAttr("style", "display: none; visibility: hidden");
			editBtn.buttonEl.setAttr("style", "visibility: hidden");
			deleteBtn.buttonEl.setAttr("style", "visibility: hidden");

			// ── Load conversation on click ────────────────────────────────
			const loadConversation = () => {
				this.plugin.chatHistory
					.load(file.path)
					.then(({ meta, messages, toolCallsByTurn }) => {
						chat.resetChat();

						// Restore tool call metadata so panels render correctly
						chat.setToolCallsByTurn(toolCallsByTurn);

						// Restore messages into the store
						chat.messageStore.setMessages(messages);
						chat.generateIMLikeMessages(messages);

						parentElement.hide();
						containerToShow.show();
						containerToShow.querySelector(".messages-div")?.scroll(0, 9999);

						// Update view model settings to match the stored model
						if (meta.model && models[meta.model]) {
							const m = models[meta.model];
							this.plugin.settings[settingType].model = meta.model;
							this.plugin.settings[settingType].modelName = meta.model;
							this.plugin.settings[settingType].modelType = m.type;
							this.plugin.settings[settingType].modelEndpoint = m.endpoint;
							this.plugin.settings[settingType].endpointURL = m.url;
						}

						// Store the file path so historyPush can update the file.
						// Also sync the ChatContainer's in-memory reference.
						setHistoryFilePath(this.plugin, this.viewType, file.path);
						chat.currentHistoryFilePath = file.path;

						header.setHeader(
							this.plugin.settings[settingType].modelName
						);
						header.resetHistoryButton();
						header.setTitle(meta.title ?? displayTitle);
						header.showTitle();
					})
					.catch((e) => {
						console.error("[HistoryContainer] Failed to load chat file:", e);
						new Notice("Failed to load conversation.");
					});
			};

			item.addEventListener("click", loadConversation);

			item.addEventListener("mouseenter", () => {
				if (text.contentEditable === "false" || text.contentEditable === "inherit") {
					editBtn.buttonEl.setAttr("style", "visibility: visible");
					deleteBtn.buttonEl.setAttr("style", "visibility: visible");
				}
			});
			item.addEventListener("mouseleave", () => {
				if (text.contentEditable === "false" || text.contentEditable === "inherit") {
					editBtn.buttonEl.setAttr("style", "visibility: hidden");
					deleteBtn.buttonEl.setAttr("style", "visibility: hidden");
				}
			});

			// ── Delete ────────────────────────────────────────────────────
			deleteBtn.onClick((e: MouseEvent) => {
				e.stopPropagation();
				new ConfirmDeleteModal(this.plugin.app, () => {
					this.plugin.chatHistory
						.delete(file.path)
						.then(() => {
							// If this was the currently open file, clear the reference
							if (
								this.plugin.settings[settingType].historyFilePath ===
								file.path
							) {
								setHistoryFilePath(this.plugin, this.viewType, null);
								chat.resetChat();
								chat.resetMessages();
								header.setHeader(
									this.plugin.settings[settingType].modelName
								);
							}
							// Re-render the list
							this.resetHistory(parentElement);
							this.generateHistoryContainer(
								parentElement,
								[],
								containerToShow,
								chat,
								header
							);
						})
						.catch((e) =>
							console.error("[HistoryContainer] Failed to delete chat file:", e)
						);
				}).open();
			});

			// ── Rename ────────────────────────────────────────────────────
			editBtn.onClick((e: MouseEvent) => {
				e.stopPropagation();
				item.removeEventListener("click", loadConversation);
				toggleContentEditable(text, true);
				text.focus();
				editBtn.buttonEl.setAttr("style", "display: none");
				saveBtn.buttonEl.setAttr("style", "display: inline-flex");
				disableOtherItems(parentElement.children, index, true);
			});

			saveBtn.onClick((e: MouseEvent) => {
				e.stopPropagation();
				const newTitle = text.textContent?.trim();
				if (!newTitle) {
					new Notice("Title must not be empty.");
					return;
				}
				this.plugin.chatHistory
					.rename(file.path, newTitle)
					.then((newPath) => {
						// If this was the currently open file, update the stored path
						if (
							this.plugin.settings[settingType].historyFilePath ===
							file.path
						) {
							setHistoryFilePath(this.plugin, this.viewType, newPath);
						}
						item.addEventListener("click", loadConversation);
						toggleContentEditable(text, false);
						editBtn.buttonEl.setAttr("style", "display: inline-flex");
						saveBtn.buttonEl.setAttr("style", "display: none");
						disableOtherItems(parentElement.children, index, false);
					})
					.catch((e) => {
						console.error("[HistoryContainer] Failed to rename chat file:", e);
						new Notice("Failed to rename conversation.");
					});
			});
		});
	}

	resetHistory(parentContainer: HTMLElement) {
		parentContainer.empty();
	}
}
