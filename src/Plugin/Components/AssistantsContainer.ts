import LLMPlugin from "main";
import {
	ButtonComponent,
	DropdownComponent,
	SearchComponent,
	Setting,
	TextComponent,
	TFile,
	ToggleComponent,
	Notice,
	Platform
} from "obsidian";
import { Assistant } from "openai/resources/beta/assistants";
import { VectorStore } from "openai/resources/beta/vector-stores/vector-stores";
import { ViewType } from "Types/types";
import { openAIModels, models } from "utils/models";
import {
	createAssistant,
	createVectorAndUpdate,
	deleteAssistant,
	deleteVector,
	listAssistants,
	listVectors,
} from "utils/utils";
import { assistant as ASSISTANT } from "utils/constants";
import { SingletonNotice } from "./SingletonNotice";

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
			.setName("Assistants options")
			.setDesc("What do you want to do?")
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption("", "---Assistant options---");
				dropdown.addOption("asst_create", "Create an assistant");
				dropdown.addOption("asst_update", "Update an assistant");
				dropdown.addOption("asst_delete", "Delete an assistant");
				dropdown.addOption("", "---Vector storage options---");
				dropdown.addOption("vect_create", "Create vector storage");
				dropdown.addOption("vect_update", "Update vector storage");
				dropdown.addOption("vect_delete", "Delete vector storage");

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
			"llm-flex",
			"assistants-create-button-div",
			"setting-item"
		);
		const submitButton = new ButtonComponent(buttonDiv);
		submitButton.buttonEl.addClass("mod-cta", "llm-assistants-button");
		submitButton.buttonEl.textContent = "Create assistant";

		submitButton.onClick(async (e: MouseEvent) => {

			const requiredFields = {
				"Name": this.createAssistantName,
				"Model": this.createAssistantModel,
			};

			const invalidFields = this.validateFields(requiredFields);
			if (invalidFields.length > 0) {
				SingletonNotice.show(`Please fill out the following fields: ${invalidFields.join(", ")}`)
				return;
			}

			SingletonNotice.show("Creating assistant...")
			e.preventDefault();

			const assistantFiles = this.assistantFilesToAdd?.map((file: string) => {
				if (Platform.isMobile) {
					return file;
				} else {
					const slashToUse = this.plugin.os.platform() === "win32" ? "\\" : "/";
					//@ts-ignore 
					const basePath = this.plugin.app.vault.adapter.basePath;

					return `${basePath}${slashToUse}${file}`;
				}
			});

			const hasFiles = this.assistantFilesToAdd?.length >= 1
			const assistantObj = {
				name: this.createAssistantName,
				instructions: this.createAssistantIntructions,
				model: this.createAssistantModel,
				tools: hasFiles ? [{ type: this.createAssistantToolType }] : null,
			};
			const assistant = await createAssistant(
				assistantObj,
				this.plugin.settings.openAIAPIKey
			);

			if (hasFiles) {
				const vector_store_id = await createVectorAndUpdate(
					assistantFiles,
					assistant,
					this.plugin.settings.openAIAPIKey,
					this.plugin.fileSystem
				);
				this.plugin.assistants.push({
					...assistant,
					modelType: ASSISTANT,
					tool_resources: {
						file_search: { vector_store_ids: [vector_store_id] },
					},
				});
			} else {
				this.plugin.assistants.push({
					...assistant,
					modelType: ASSISTANT
				});
			}

			// Note -> this notice shows up much faster than the UI pushes to the next view
			if (assistant) {
				new Notice("Assistant created successfully");
			}

			this.resetContainer(parentContainer);
		});
	}

	async updateAssistant(parentContainer: HTMLElement) {
		const assistantsList = await listAssistants(
			this.plugin.settings.openAIAPIKey
		);
		let chosenAssistant: Assistant;
		const assistants = new Setting(parentContainer)
			.setName("Assistants")
			.setDesc("Which assistant do you want to update?")
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption("", "---Select an assistant---");
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
		updateSettings.addClass("llm-update-settings");
		this.updateSettings = updateSettings;
		this.generateGenericSettings(this.updateSettings, "update");
		this.generateUpdateAssistants(this.updateSettings);

		const buttonDiv = parentContainer.createDiv();
		buttonDiv.addClass("llm-flex", "update-button-div", "setting-item");
		const submitButton = new ButtonComponent(buttonDiv);
		submitButton.buttonEl.addClass("mod-cta", "llm-assistants-button");
		submitButton.buttonEl.textContent = "Update assistant";

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
		});
	}

	deleteAssistant(parentContainer: HTMLElement) {
		const assistants: Assistant[] = this.plugin.settings.assistants;
		if (assistants.length < 1) {
			parentContainer.createEl("div", {
				text: "No assistants found",
				cls: "assistants-empty-state"
			});
		}
		assistants.map((assistant: Assistant, index: number) => {
			const item = parentContainer.createDiv();
			const text = item.createEl("p", {
				text: assistant.name as string,
			});
			const buttonsDiv = item.createDiv();
			buttonsDiv.addClass("history-buttons-div", "llm-flex");
			const deleteHistory = new ButtonComponent(buttonsDiv);
			deleteHistory.buttonEl.setAttr("style", "visibility: hidden");

			item.className = "setting-item";
			item.setAttr("contenteditable", "false");
			item.addClass("llm-history-item", "llm-flex");
			deleteHistory.buttonEl.addClass(
				"llm-delete-history-button",
				"mod-warning"
			);
			deleteHistory.buttonEl.id = "llm-delete-history-button";

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
		const files = this.plugin.app.vault.getFiles();
		this.generateGenericSettings(parentContainer, "create");
		const file_ids = new Setting(parentContainer).setName("Search");
		let filesDiv = parentContainer.createEl("div");
		filesDiv.addClass("setting-item", "llm-vector-dropdown");
		let header = filesDiv.createEl("div");
		header.addClass("setting-item-info");
		let searchDiv = filesDiv.createEl("div");
		searchDiv.addClass("setting-item-control", "llm-vector-files");
		file_ids.addSearch((search: SearchComponent) => {
			search.onChange((change) => {
				searchDiv.empty();
				if (change === "") {
					searchDiv.empty();
					return;
				}
				const options = files.filter((file: TFile) =>
					file.basename.toLowerCase().includes(change.toLowerCase())
				);
				options.map((option: TFile) => {
					const item = searchDiv.createEl("span", {
						text: option.name,
						cls: "llm-vector-file"
					});
					if (filePathArray.includes(option.path))
						item.addClass("llm-file-added");

					item.onClickEvent((click: MouseEvent) => {
						if (filePathArray.includes(option.path)) {
							item.removeClass("llm-file-added");
							filePathArray = filePathArray.filter(
								(file_path: string) => file_path !== option.path
							);
						} else {
							item.addClass("llm-file-added");
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
			.setName("Vector storage name")
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
			const text = item.createEl("p", {
				text: vectorStore.name
			});
			const buttonsDiv = item.createDiv();
			buttonsDiv.addClass("history-buttons-div", "llm-flex");
			const deleteHistory = new ButtonComponent(buttonsDiv);
			deleteHistory.buttonEl.setAttr("style", "visibility: hidden");

			item.className = "setting-item";
			item.setAttr("contenteditable", "false");
			item.addClass("llm-history-item", "llm-flex");
			deleteHistory.buttonEl.addClass(
				"llm-delete-history-button",
				"mod-warning"
			);
			deleteHistory.buttonEl.id = "llm-delete-history-button";

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
			.setName("Assistant name")
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
			.setName("Assistant instructions")
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
			.setName("Assistant model")
			.setDesc("Which LLM you want your assistant to use")
			.addDropdown((dropdown: DropdownComponent) => {
				if (assistant) dropdown.setValue(assistant.model as string);
				dropdown.addOption("", "---Select model---");
				let keys = Object.keys(openAIModels);
				for (let model of keys) {
					dropdown.addOption(models[model].model, model);
				}

				dropdown.onChange((change) => {
					option === "create"
						? (this.createAssistantModel = change)
						: (this.updateAssistantModel = change);
				});
			});

		const assistantToolType = new Setting(parentContainer)
			.setName("Assistant tool type")
			.setDesc("File search or code review") // NOTE -> we do not support Code Review at this point.
			.addDropdown((dropdown: DropdownComponent) => {
				if (assistant)
					dropdown.setValue(assistant.tools[0].type as string);
				dropdown.addOption("", "---Tool type---");
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
			.setName("Tool resources")
			.setDesc(
				"A set of resources that are used by the assistant's tools. The resources are specific to the type of tool. For example, the code_interpreter tool requires a list of file IDs, while the file_search tool requires a list of vector store IDs."
			)
			.addToggle((toggle: ToggleComponent) => {
				const trDiv = parentContainer.createEl("div");
				toggle.onChange((change) => {
					if (change) {
						const vector_store_ids = new Setting(trDiv)
							.setName("Vector store")
							.setDesc(
								"The new vector store id to attach to ths assistant"
							)
							.addDropdown((dropdown: DropdownComponent) => {
								dropdown.addOption(
									"",
									"---Select vector store---"
								);
								dropdown.addOption("vectorStoreId", "ID");
								dropdown.onChange((change) => {
									this.updateAssistantVectorStoreID = change;
								});
							});
					}
					if (!change) {
						trDiv.empty();
					}
				});
			});
		//assistant.tool_resources?.file_search?.vector_store_ids
		new Setting(parentContainer)
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

		new Setting(parentContainer)
			.setName("Top p")
			.setDesc(
				"Defaults to 1. An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered."
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
		parentContainer.empty();
		if (total) this.generateAssistantsContainer(parentContainer);
	}
}
