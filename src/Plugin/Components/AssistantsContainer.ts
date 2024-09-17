import LLMPlugin from "main";
import {
	ButtonComponent,
	DropdownComponent,
	SearchComponent,
	Setting,
	TextComponent,
	TFile,
	ToggleComponent,
	Notice
} from "obsidian";
import { Assistant } from "openai/resources/beta/assistants";
import { VectorStore } from "openai/resources/beta/vector-stores/vector-stores";
import { ViewType } from "Types/types";
import { openAIModels, models } from "utils/models";
import {
	createAssistant,
	createVectorAndUpdate,
	DEFAULT_DIRECTORY,
	deleteAssistant,
	deleteVector,
	isWindows,
	listAssistants,
	listVectors,
} from "utils/utils";
import { assistant as ASSISTANT, GPT4All } from "utils/constants";
import { SingletonNotice } from "./SingletonNotice";
const fs = require("fs");

export class AssistantsContainer {
	viewType: ViewType;
	filesSetting: Setting;
	createAssistantName: string;
	createAssistantIntructions: string;
	createAssistantToolType: string;
	createAssistantModel: string;
	assistantFilesToAdd: string[];
	updateSettings: HTMLElement;
	updateAssistantName: string;
	updateAssistantIntructions: string;
	updateAssistantToolType: string;
	updateAssistantModel: string;
	updateAssistantTemperature: number;
	updateAssistantTopP: number;
	updateAssistantVectorStoreID: string;
	vectorFilesToAdd: string[];

	constructor(private plugin: LLMPlugin, viewType: ViewType) {
		this.viewType = viewType;
	}

	private validateFields(fields: { [key: string]: any }): string[] {
		const invalidFields: string[] = [];
		for (const [fieldName, value] of Object.entries(fields)) {
			if (!value) {
				invalidFields.push(fieldName);
			}
		}
		return invalidFields;
	}

	async generateAssistantsContainer(parentContainer: HTMLElement) {
		const optionDropdown = new Setting(parentContainer)
			.setName("Assistants Options")
			.setDesc("What do you want to do?")
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption("", "---Assistant Options---");
				dropdown.addOption("asst_create", "Create an Assistant");
				dropdown.addOption("asst_update", "Update an Assistant");
				dropdown.addOption("asst_delete", "Delete an Assistant");
				dropdown.addOption("", "---Vector Storage Options---");
				dropdown.addOption("vect_create", "Create Vector Storage");
				dropdown.addOption("vect_update", "Update Vector Storage");
				dropdown.addOption("vect_delete", "Delete Vector Storage");

				dropdown.onChange((change) => {
					this.resetContainer(parentContainer);
					switch (change) {
						case "asst_create":
							this.createAssistant(parentContainer);
							return;
						case "asst_update":
							this.updateAssistant(parentContainer);
							return;
						case "asst_delete":
							this.deleteAssistant(parentContainer);
							return;
						case "vect_create":
							this.createVector(parentContainer);
							return;
						case "vect_update":
							this.updateVector(parentContainer);
							return;
						case "vect_delete":
							this.deleteVector(parentContainer);
							return;
					}
				});
			});
	}

	// NOTE -> for both the create assistant flow we should dump the this.createAssistant name & other fields
	// after a successful submission event.
	createAssistant(parentContainer: HTMLElement) {
		const file_ids = this.createSearch(
			parentContainer,
			ASSISTANT,
			true
		) as Setting;
		this.filesSetting = file_ids;
		file_ids.settingEl.setAttr("style", "display:none");

		const buttonDiv = parentContainer.createDiv();
		buttonDiv.addClass(
			"flex",
			"assistants-create-button-div",
			"setting-item"
		);
		const submitButton = new ButtonComponent(buttonDiv);
		submitButton.buttonEl.addClass("mod-cta", "assistants-button");
		submitButton.buttonEl.textContent = "Create Assistant";

		submitButton.onClick(async (e: MouseEvent) => {
			const hasFiles = this.assistantFilesToAdd?.length >= 1

			const requiredFields = {
				"Name": this.createAssistantName,
				"Model": this.createAssistantModel,
				"Files": hasFiles,
			};

			const invalidFields = this.validateFields(requiredFields);
			if (invalidFields.length > 0) {
				SingletonNotice.show(`Please fill out the following fields: ${invalidFields.join(", ")}`)
				return;
			}

			SingletonNotice.show("Creating Assistant...")
			e.preventDefault();
			//@ts-ignore
			const basePath = app.vault.adapter.basePath;
			const slashToUse = isWindows() ? "\\" : "/";

			const assistantFiles = this.assistantFilesToAdd.map(
				(file: string) => {
					return `${basePath}${slashToUse}${file}`;
				}
			);

			const assistantObj = {
				name: this.createAssistantName,
				instructions: this.createAssistantIntructions,
				model: this.createAssistantModel,
				tools: [{ type: this.createAssistantToolType }],
			};
			const assistant = await createAssistant(
				assistantObj,
				this.plugin.settings.openAIAPIKey
			);

			const vector_store_id = await createVectorAndUpdate(
				assistantFiles,
				assistant,
				this.plugin.settings.openAIAPIKey
			);

			// Note -> this notice shows up much faster than the UI pushes to the next view
			if (assistant) {
				new Notice("Assistant Created Successfully");
			}

			this.plugin.assistants.push({
				...assistant,
				modelType: ASSISTANT,
				tool_resources: {
					file_search: { vector_store_ids: [vector_store_id] },
				},
			});

			this.resetContainer(parentContainer);
		});
	}

	// TODO - add validation
	async updateAssistant(parentContainer: HTMLElement) {
		const assistantsList = await listAssistants(
			this.plugin.settings.openAIAPIKey
		);
		let chosenAssistant: Assistant;
		const assistants = new Setting(parentContainer)
			.setName("Assistants")
			.setDesc("Which Assistant do you want to update?")
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption("", "---Select an Assistant---");
				assistantsList.map((assistant: Assistant) => {
					dropdown.addOption(assistant.id, assistant.name as string);
					dropdown.onChange((change) => {
						chosenAssistant = assistantsList.find(
							(assistant: Assistant) => assistant.id === change
						) as Assistant;
						this.resetContainer(this.updateSettings, false);
						this.generateGenericSettings(
							this.updateSettings,
							"update",
							chosenAssistant
						);
						this.generateUpdateAssistants(
							this.updateSettings,
							chosenAssistant
						);
					});
				});
			});

		const updateSettings = parentContainer.createEl("div");
		updateSettings.addClass("update-settings");
		this.updateSettings = updateSettings;
		this.generateGenericSettings(this.updateSettings, "update");
		this.generateUpdateAssistants(this.updateSettings);

		const buttonDiv = parentContainer.createDiv();
		buttonDiv.addClass("flex", "update-button-div", "setting-item");
		const submitButton = new ButtonComponent(buttonDiv);
		submitButton.buttonEl.addClass("mod-cta", "assistants-button");
		submitButton.buttonEl.textContent = "Update Assistant";

		submitButton.onClick((event: MouseEvent) => {
			event.preventDefault();

			const assistantObj = {
				name: this.updateAssistantName,
				instructions: this.updateAssistantIntructions,
				model: this.updateAssistantModel,
				tools: [{ type: this.updateAssistantToolType }],
				topP: this.updateAssistantTopP,
				temperature: this.updateAssistantTemperature,
			};

			console.log(assistantObj);
		});
	}

	deleteAssistant(parentContainer: HTMLElement) {
		const assistants: Assistant[] = this.plugin.settings.assistants;
		if (assistants.length < 1) {
			const empty = parentContainer.createEl("div");
			empty.innerHTML = "empty";
		}
		assistants.map((assistant: Assistant, index: number) => {
			const item = parentContainer.createDiv();
			const text = item.createEl("p");
			text.innerHTML = assistant.name as string;
			const buttonsDiv = item.createDiv();
			buttonsDiv.addClass("history-buttons-div", "flex");
			const deleteHistory = new ButtonComponent(buttonsDiv);
			deleteHistory.buttonEl.setAttr("style", "visibility: hidden");

			item.className = "setting-item";
			item.setAttr("contenteditable", "false");
			item.addClass("history-item", "flex");
			deleteHistory.buttonEl.addClass(
				"delete-history-button",
				"mod-warning"
			);
			deleteHistory.buttonEl.id = "delete-history-button";

			item.addEventListener("mouseenter", () => {
				if (
					text.contentEditable == "false" ||
					text.contentEditable == "inherit"
				) {
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
					deleteHistory.buttonEl.setAttr(
						"style",
						"visibility: hidden"
					);
				}
			});

			deleteHistory.setIcon("trash");
			deleteHistory.onClick((e: MouseEvent) => {
				e.stopPropagation();
				deleteAssistant(
					this.plugin.settings.openAIAPIKey,
					assistant.id
				);
				this.resetContainer(parentContainer);
				let updatedAssistants = this.plugin.settings.assistants.filter(
					(item, idx) => idx !== index
				);
				this.plugin.settings.assistants = updatedAssistants;
				this.plugin.saveSettings();
			});
		});
	}

	createSearch(
		parentContainer: HTMLElement,
		assistantOption: typeof ASSISTANT | "vector",
		needsReturn?: boolean
	) {
		let filePathArray: string[] = [];
		const files = app.vault.getFiles();
		this.generateGenericSettings(parentContainer, "create");
		const file_ids = new Setting(parentContainer).setName("Search");
		let filesDiv = parentContainer.createEl("div");
		filesDiv.addClass("setting-item", "vector-dropdown");
		let header = filesDiv.createEl("div");
		header.addClass("setting-item-info");
		let searchDiv = filesDiv.createEl("div");
		searchDiv.addClass("setting-item-control", "vector-files");
		file_ids.addSearch((search: SearchComponent) => {
			search.onChange((change) => {
				searchDiv.innerHTML = "";
				if (change === "") {
					searchDiv.innerHTML = "";
					return;
				}
				const options = files.filter((file: TFile) =>
					file.basename.toLowerCase().includes(change.toLowerCase())
				);
				options.map((option: TFile) => {
					const item = searchDiv.createEl("option");
					if (filePathArray.includes(option.path))
						item.addClass("file-added");
					item.addClass("vector-file");
					item.innerHTML = option.name;

					item.onClickEvent((click: MouseEvent) => {
						if (filePathArray.includes(option.path)) {
							item.removeClass("file-added");
							filePathArray = filePathArray.filter(
								(file_path: string) => file_path !== option.path
							);
						} else {
							item.addClass("file-added");
							filePathArray = [...filePathArray, option.path];
						}
						assistantOption === ASSISTANT
							? (this.assistantFilesToAdd = filePathArray)
							: (this.vectorFilesToAdd = filePathArray);
					});
				});
			});
		});
		if (needsReturn) return file_ids;
	}

	createVector(parentContainer: HTMLElement) {
		let vectorName = "";
		const name = new Setting(parentContainer)
			.setName("Vector Storage Name")
			.setDesc("The name for your new vector storage")
			.addText((text: TextComponent) => {
				text.onChange((change) => { });
			});
	}

	updateVector(parentContainer: HTMLElement) { }

	async deleteVector(parentContainer: HTMLElement) {
		const vectorStores = await listVectors(
			this.plugin.settings.openAIAPIKey
		);
		vectorStores.map((vectorStore: VectorStore, index: number) => {
			const item = parentContainer.createDiv();
			const text = item.createEl("p");
			text.innerHTML = vectorStore.name;
			const buttonsDiv = item.createDiv();
			buttonsDiv.addClass("history-buttons-div", "flex");
			const deleteHistory = new ButtonComponent(buttonsDiv);
			deleteHistory.buttonEl.setAttr("style", "visibility: hidden");

			item.className = "setting-item";
			item.setAttr("contenteditable", "false");
			item.addClass("history-item", "flex");
			deleteHistory.buttonEl.addClass(
				"delete-history-button",
				"mod-warning"
			);
			deleteHistory.buttonEl.id = "delete-history-button";

			item.addEventListener("mouseenter", () => {
				if (
					text.contentEditable == "false" ||
					text.contentEditable == "inherit"
				) {
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
					deleteHistory.buttonEl.setAttr(
						"style",
						"visibility: hidden"
					);
				}
			});

			deleteHistory.setIcon("trash");
			deleteHistory.onClick((e: MouseEvent) => {
				e.stopPropagation();
				deleteVector(this.plugin.settings.openAIAPIKey, vectorStore.id);
				this.resetContainer(parentContainer);
			});
		});
	}

	generateGenericSettings(
		parentContainer: HTMLElement,
		option: string,
		assistant?: Assistant
	) {
		const assistantName = new Setting(parentContainer)
			.setName("Assistant Name")
			.setDesc("The name to be attributed to the new assistant")
			.addText((text) => {
				if (assistant) text.setValue(assistant.name as string);
				text.inputEl.type = "text";
				text.onChange((change) => {
					option === "create"
						? (this.createAssistantName = change)
						: (this.updateAssistantName = change);
				});
			});

		const assistantIntructions = new Setting(parentContainer)
			.setName("Assistant Instructions")
			.setDesc("The system instructions for the assistant to follow.")
			.addText((text) => {
				if (assistant) text.setValue(assistant.instructions as string);
				text.inputEl.type = "text";
				text.onChange((change) => {
					option === "create"
						? (this.createAssistantIntructions = change)
						: (this.updateAssistantIntructions = change);
				});
			});

		const assistantModel = new Setting(parentContainer)
			.setName("Assistant Model")
			.setDesc("Which LLM you want your assistant to use")
			.addDropdown((dropdown: DropdownComponent) => {
				if (assistant) dropdown.setValue(assistant.model as string);
				dropdown.addOption("", "---Select Model---");
				let keys = Object.keys(openAIModels);
				for (let model of keys) {
					// QUESTION -> can gtp4all have an assistant
					if (models[model].type === GPT4All) {
						fs.exists(
							`${DEFAULT_DIRECTORY}/${models[model].model}`,
							(exists: boolean) => {
								if (exists) {
									dropdown.addOption(
										models[model].model,
										model
									);
								}
							}
						);
					} else {
						dropdown.addOption(models[model].model, model);
					}
				}

				dropdown.onChange((change) => {
					option === "create"
						? (this.createAssistantModel = change)
						: (this.updateAssistantModel = change);
				});
			});

		// TODO - make this required
		const assistantToolType = new Setting(parentContainer)
			.setName("Assistant Tool Type")
			.setDesc("File Search or Code Review") // NOTE -> we do not support Code Review at this point.
			.addDropdown((dropdown: DropdownComponent) => {
				if (assistant)
					dropdown.setValue(assistant.tools[0].type as string);
				dropdown.addOption("", "---Tool Type---");
				dropdown.addOption("file_search", "File Search");
				// dropdown.addOption("code_interpreter", "Code Interpreter");

				dropdown.onChange((change) => {
					if (option === "create") {
						this.createAssistantToolType = change;
						change === "file_search"
							? this.filesSetting.settingEl.setAttr(
								"style",
								"display:flex"
							)
							: this.filesSetting.settingEl.setAttr(
								"style",
								"display:none"
							);
					} else this.updateAssistantToolType = change;
				});
			});
	}

	generateUpdateAssistants(
		parentContainer: HTMLElement,
		assistant?: Assistant
	) {
		const tool_resources = new Setting(parentContainer)
			.setName("Tool Resources")
			.setDesc(
				"A set of resources that are used by the assistant's tools. The resources are specific to the type of tool. For example, the code_interpreter tool requires a list of file IDs, while the file_search tool requires a list of vector store IDs."
			)
			.addToggle((toggle: ToggleComponent) => {
				const trDiv = parentContainer.createEl("div");
				toggle.onChange((change) => {
					if (change) {
						const vector_store_ids = new Setting(trDiv)
							.setName("Vector Store")
							.setDesc(
								"The new vector store id to attach to ths assistant"
							)
							.addDropdown((dropdown: DropdownComponent) => {
								dropdown.addOption(
									"",
									"---Select Vectore Store---"
								);
								dropdown.addOption("vectorStoreId", "ID");
								dropdown.onChange((change) => {
									this.updateAssistantVectorStoreID = change;
								});
							});
					}
					if (!change) {
						trDiv.innerHTML = "";
					}
				});
			});
		//assistant.tool_resources?.file_search?.vector_store_ids
		const tempSetting = new Setting(parentContainer)
			.setName("Temperature")
			.setDesc(
				"Defaults to 1. What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic. We generally recommend altering this or top_p but not both."
			)
			.addText((text) => {
				if (assistant) text.setValue(`${assistant.temperature}`);
				text.inputEl.type = "number";
				text.onChange((change) => {
					this.updateAssistantTemperature = parseFloat(change);
				});
			});

		const topPSetting = new Setting(parentContainer)
			.setName("Temperature")
			.setDesc(
				"Defaults to 1. What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic. We generally recommend altering this or top_p but not both."
			)
			.addText((text) => {
				if (assistant) text.setValue(`${assistant.top_p}`);
				text.inputEl.type = "number";
				text.onChange((change) => {
					this.updateAssistantTopP = parseFloat(change);
				});
			});
	}

	resetContainer(parentContainer: HTMLElement, total: boolean = true) {
		parentContainer.innerHTML = "";
		if (total) this.generateAssistantsContainer(parentContainer);
	}
}
