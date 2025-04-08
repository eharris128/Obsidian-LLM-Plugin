import { HistoryItem, ViewType } from "Types/types";
import LLMPlugin, { DEFAULT_SETTINGS } from "main";
import { ButtonComponent, Notice } from "obsidian";
import { ChatContainer } from "./ChatContainer";
import { Header } from "./Header";
import { models } from "utils/models";
import { assistant } from "utils/constants";
import { getSettingType } from "utils/utils";
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
		if (this.viewType === 'floating-action-button') {
			return 'fab';
		} else if (this.viewType === 'widget') {
			return this.viewType;
		} else if (this.viewType === 'modal') {
			return this.viewType
		}
	};
	
	displayNoHistoryView(parentElement: HTMLElement) {
		parentElement.addClass('llm-justify-content-center');

		const llmGal = parentElement.createDiv();
		llmGal.addClass("llm-icon-wrapper");

		// Parse SVG string to DOM element
		const parser = new DOMParser();
		const svgDoc = parser.parseFromString(logo, "image/svg+xml");
		const svgElement = svgDoc.documentElement;

		// Append the SVG element
		llmGal.appendChild(svgElement);

		const cta = llmGal.createEl("div", {
			attr: {
				class: 'empty-history-cta llm-font-size-medium llm-justify-content-center'
			},
			text: 'Looking kind of empty. Start chatting and conversations will appear here.'
		})
		cta.addClass('text-align-center')

		const createChatButton = new ButtonComponent(cta)
		createChatButton.setButtonText('New chat')
		createChatButton.setClass('llm-empty-history-button')
		createChatButton.setClass('mod-cta')

		createChatButton.onClick(() => {
			parentElement.hide();	
			const activeHistoryButton = document.querySelector('.chat-history.is-active')
			activeHistoryButton?.classList.remove('is-active');

			const prefix = this.getChatContainerClassPrefix()
			const chatContainer = document.querySelector(`[class*="${prefix}-chat-container"]`) as HTMLElement

			chatContainer.show();
			parentElement.classList.remove('llm-justify-content-center');
		})
	
	}

	generateHistoryContainer(
		parentElement: HTMLElement,
		history: HistoryItem[],
		containerToShow: HTMLElement,
		chat: ChatContainer,
		Header: Header
	) {
		if (!history.length) {
			this.displayNoHistoryView(parentElement)
			return
		}

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
			chat.generateIMLikeMessgaes(messages);
			containerToShow.querySelector(".messages-div")?.scroll(0, 9999);
			const index = this.historyIndex;
			const header = this.plugin.settings.promptHistory[index].prompt;
			const modelName =
				this.plugin.settings.promptHistory[index].modelName;
			const model =
				this.plugin.settings.promptHistory[index].model;
			this.plugin.settings[settingType].modelName = modelName;
			if (!model.includes("asst")) {
				this.plugin.settings[settingType].model =
					models[modelName].model;
				this.plugin.settings[settingType].modelType =
					models[modelName].type;
				this.plugin.settings[settingType].modelEndpoint =
					models[modelName].endpoint;
				this.plugin.settings[settingType].endpointURL =
					models[modelName].url;
			} else {
				this.plugin.settings[settingType].model =
					this.plugin.settings.promptHistory[index].model;
				this.plugin.settings[settingType].modelName =
					this.plugin.settings.promptHistory[index].modelName;
				this.plugin.settings[settingType].modelType = assistant;
				this.plugin.settings[settingType].modelEndpoint = assistant;
				this.plugin.settings[settingType].endpointURL = "";
			}
			this.plugin.saveSettings();
			Header.setHeader(modelName, header);
			Header.resetHistoryButton();
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
			const displayHTML = historyItem?.prompt || historyItem?.messages[0]?.content;
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
				Header.setHeader(this.modelName, "Local LLM plugin");
				this.plugin.settings[settingType].historyIndex =
					DEFAULT_SETTINGS[settingType].historyIndex;
				this.plugin.saveSettings();
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

	resetHistory(parentContainer: HTMLElement) {
		parentContainer.empty();
	}
}
