import { ImageSize, ViewType } from "Types/types";
import LLMPlugin from "main";
import { DropdownComponent, Setting, Platform } from "obsidian";
import { Assistant } from "openai/resources/beta/assistants";
import { modelNames, models } from "utils/models";
import {
	DEFAULT_DIRECTORY,
	getAssistant,
	getSettingType,
	getViewInfo,
} from "utils/utils";
import { assistant as ASSISTANT, chat, GPT4All, messages, openAI } from "utils/constants"
import { Header } from "./Header";

const fs = !Platform.isMobile ? require("fs") : null;

export class SettingsContainer {
	viewType: ViewType;

	constructor(private plugin: LLMPlugin, viewType: ViewType) {
		this.viewType = viewType;
	}

	async generateSettingsContainer(parentContainer: HTMLElement, Header: Header) {
		this.resetSettings(parentContainer);
		this.generateModels(parentContainer, Header);
		this.generateModelSettings(parentContainer);
	}

	generateModels(parentContainer: HTMLElement, Header: Header) {
		const settingType = getSettingType(this.viewType);
		const viewSettings = this.plugin.settings[settingType];

		// Create the dropdown model selector
		new Setting(parentContainer)
			.setName("Models")
			.setDesc("The model you want to use to generate a chat response.")
			.addDropdown((dropdown: DropdownComponent) => {
				// NOTE -> we only want to display assistants when using OpenAI
				dropdown.addOption("", "---Select Assistant---");
				const assistants = this.plugin.settings.assistants;
				assistants.map((assistant: Assistant) => {
					dropdown.addOption(`${assistant.id}`, `${assistant.name}`);
				});
				dropdown.addOption("", "---Select Model---");
				let keys = Object.keys(models);
				for (let model of keys) {
					if (models[model].type === GPT4All) {
						if (Platform.isMobile) {
							continue
						}
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
					console.log(change);
					const { historyIndex } = getViewInfo(
						this.plugin,
						this.viewType
					);
					const index = historyIndex;
					if (change.includes("asst")) {
						viewSettings.assistant = true;
						this.plugin.saveSettings();
					} else {
						viewSettings.assistant = false;
						viewSettings.assistantId = "";
						this.plugin.saveSettings();
					}
					if (!viewSettings.assistant) {
						const modelName = modelNames[change];
						viewSettings.model = change;
						viewSettings.modelName = modelName;
						viewSettings.modelType = models[modelName].type;
						viewSettings.endpointURL = models[modelName].url;
						viewSettings.modelEndpoint = models[modelName].endpoint;
						if (index > -1) {
							this.plugin.settings.promptHistory[index].model =
								change;
							this.plugin.settings.promptHistory[
								index
							].modelName = modelName;
						}
						this.plugin.saveSettings();
						Header.setHeader(modelName);
					}
					if (viewSettings.assistant) {
						viewSettings.assistantId = change;
						const assistant = getAssistant(
							this.plugin,
							viewSettings.assistantId
						);
						viewSettings.model = assistant!.id;
						viewSettings.modelName = assistant!.name as string;
						viewSettings.modelType = assistant!.modelType;
						viewSettings.endpointURL = "";
						viewSettings.modelEndpoint = ASSISTANT;
						if (index > -1) {
							this.plugin.settings.promptHistory[index].model =
								assistant!.model;
							this.plugin.settings.promptHistory[
								index
							].modelName = modelNames[assistant!.model];
						}
						this.plugin.saveSettings();
						Header.setHeader(assistant.name as string);
					}
					this.generateSettingsContainer(parentContainer, Header);
				});
				dropdown.setValue(viewSettings.model);
			});
	}

	resetSettings(parentContainer: Element) {
		parentContainer.innerHTML = "";
	}

	generateModelSettings(parentContainer: HTMLElement) {
		const settingType = getSettingType(this.viewType);
		const viewSettings = this.plugin.settings[settingType];
		const endpoint = viewSettings.modelEndpoint;
		const modelType = viewSettings.modelType;
		if (endpoint === "images") {
			this.generateImageSettings(parentContainer, viewSettings.model);
		}
		if (endpoint === "speech") {
			this.generateTTSSettings(parentContainer);
		}
		if (endpoint === "moderations") {
			this.generateModerationsSettings(parentContainer);
		}
		if (endpoint === chat || messages) {
			this.generateChatSettings(parentContainer, modelType);
		}
	}

	generateImageSettings(parentContainer: HTMLElement, model: string) {
		const settingType = getSettingType(this.viewType);
		const viewSettings = this.plugin.settings[settingType];
		const imageSizes = {
			dallE2: ["256x256", "512x512", "1024x1024"],
			dallE3: ["1024x1024", "1792x1024", "1024x1792"],
		};
		const numberOfImages = new Setting(parentContainer)
			.setName("Number of Images")
			.setDesc(
				"The number of images generated by the model. Must be between 1 and 10. For Dall-E 3, only 1 image can be generated."
			)
			.addText((text) => {
				text.setValue(`${viewSettings.imageSettings.numberOfImages}`);
				text.inputEl.type = "number";
				text.onChange((change) => {
					viewSettings.imageSettings.numberOfImages =
						parseInt(change);
					this.plugin.saveSettings();
				});
			});

		const responseFormat = new Setting(parentContainer)
			.setName("Response Format")
			.setDesc(
				"The format in which the generated images are returned. Must be one of url or b64_json. URLs are only valid for 60 minutes after the image has been generated."
			)
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption("", "Select a Format");
				dropdown.addOption("url", "URL");
				dropdown.addOption("b64_json", "Base64 JSON");
				dropdown.onChange((change) => {
					viewSettings.imageSettings.response_format = change as
						| "url"
						| "b64_json";
					this.plugin.saveSettings();
				});
			});

		const imageSize = new Setting(parentContainer)
			.setName("Image Size")
			.setDesc(
				"The size of the generated images. Must be one of 256x256, 512x512, or 1024x1024 for dall-e-2. Must be one of 1024x1024, 1792x1024, or 1024x1792 for dall-e-3 models."
			)
			.addDropdown((dropdown: DropdownComponent) => {
				if (model === "dall-e-2") {
					dropdown.addOption("", "Dall-E 2 Sizes");
					imageSizes["dallE2"].map((size) => {
						dropdown.addOption(size, size);
					});
				}
				if (model === "dall-e-3") {
					dropdown.addOption("", "Dall-E 3 Sizes");
					imageSizes["dallE3"].map((size) => {
						dropdown.addOption(size, size);
					});
				}

				dropdown.onChange((change: ImageSize) => {
					viewSettings.imageSettings.size = change;
					this.plugin.saveSettings();
				});
			});

		if (model === "dall-e-3") {
			const imageStyle = new Setting(parentContainer)
				.setName("Image Style")
				.setDesc(
					"Defaults to vivid. Must be one of vivid or natural. Vivid causes the model to lean towards generating hyper-real and dramatic images. Natural causes the model to produce more natural, less hyper-real looking images. This param is only supported for dall-e-3."
				)
				.addDropdown((dropdown: DropdownComponent) => {
					dropdown.addOption("", "Select Style");
					dropdown.addOption("natural", "Natural");
					dropdown.addOption("vivid", "Vivid");
					dropdown.onChange((change: "vivid" | "natural") => {
						viewSettings.imageSettings.style = change;
						this.plugin.saveSettings();
					});
				});

			const quality = new Setting(parentContainer)
				.setName("Quality")
				.setDesc(
					"The quality of the image that will be generated. hd creates images with finer details and greater consistency across the image. This param is only supported for dall-e-3."
				)
				.addToggle((value) => {
					value.onChange(async (value) => {
						if (value) {
							viewSettings.imageSettings.quality = "hd";
						} else {
							viewSettings.imageSettings.quality = "standard";
						}

						this.plugin.saveSettings();
					});
				});
		}
	}

	generateChatSettings(parentContainer: HTMLElement, modelType: string) {
		const settingType = getSettingType(this.viewType);
		const viewSettings = this.plugin.settings[settingType];
		const tempSetting = new Setting(parentContainer)
			.setName("Temperature")
			.setDesc(
				modelType !== GPT4All
					? "Defaults to 1. What sampling temperature to use, between 0 and 2. Higher values like 0.8 will make the output more random, while lower values like 0.2 will make it more focused and deterministic. We generally recommend altering this or top_p but not both."
					: "Higher temperatures (eg., 1.2) increase randomness, resulting in more imaginative and diverse text. Lower temperatures (eg., 0.5) make the output more focused, predictable, and conservative. A safe range would be around 0.6 - 0.85"
			)
			.addText((text) => {
				text.setValue(`${viewSettings.chatSettings.temperature}`);
				text.inputEl.type = "number";
				text.onChange((change) => {
					viewSettings.chatSettings.temperature = parseFloat(change);
					this.plugin.saveSettings();
				});
			});

		const tokenSetting = new Setting(parentContainer)
			.setName("Tokens")
			.setDesc("The number of tokens used in the completion.")
			.addText((text) => {
				text.setValue(`${viewSettings.chatSettings.maxTokens}`);
				text.inputEl.type = "number";
				text.onChange((change) => {
					viewSettings.chatSettings.maxTokens = parseInt(change);
					this.plugin.saveSettings();
				});
			});

		if (modelType === openAI) {
			const frequencyPenalty = new Setting(parentContainer)
				.setName("Frequency Penalty")
				.setDesc(
					"Defaults to 0. Number between -2.0 and 2.0. Positive values penalize new tokens based on their existing frequency in the text so far, decreasing the model's likelihood to repeat the same line verbatim."
				)
				.addText((text) => {
					text.setValue(
						`${viewSettings.chatSettings.openAI?.frequencyPenalty}`
					);
					text.inputEl.type = "number";
					text.onChange((change) => {
						viewSettings.chatSettings.openAI!.frequencyPenalty =
							parseFloat(change);
						this.plugin.saveSettings();
					});
				});

			const logProbs = new Setting(parentContainer)
				.setName("logprobs")
				.setDesc(
					"Defaults to false. Whether to return log probabilities of the output tokens or not. If true, returns the log probabilities of each output token returned in the content of message."
				)
				.addToggle((value) => {
					value.onChange((change) => {
						viewSettings.chatSettings.openAI!.logProbs = change;
						this.plugin.saveSettings();
					});
				});

			const topLogProbs = new Setting(parentContainer)
				.setName("top_logprobs")
				.setDesc(
					"An integer between 0 and 5 specifying the number of most likely tokens to return at each token position, each with an associated log probability. logprobs must be set to true if this parameter is used."
				)
				.addText((text) => {
					text.setValue(
						`${viewSettings.chatSettings.openAI?.topLogProbs}`
					);
					text.inputEl.type = "number";
					text.onChange((change) => {
						viewSettings.chatSettings.openAI!.topLogProbs =
							parseFloat(change);
						this.plugin.saveSettings();
					});
				});

			const presencePenalty = new Setting(parentContainer)
				.setName("Presence Penalty")
				.setDesc(
					"Defaults to 0. Number between -2.0 and 2.0. Positive values penalize new tokens based on whether they appear in the text so far, increasing the model's likelihood to talk about new topics."
				)
				.addText((text) => {
					text.setValue(
						`${viewSettings.chatSettings.openAI?.presencePenalty}`
					);
					text.inputEl.type = "number";
					text.onChange((change) => {
						viewSettings.chatSettings.openAI!.presencePenalty =
							parseFloat(change);
						this.plugin.saveSettings();
					});
				});

			const responseFormat = new Setting(parentContainer)
				.setName("Response Format")
				.setDesc(
					`An object specifying the format that the model must output. Compatible with GPT-4 Turbo and all GPT-3.5 Turbo models newer than gpt-3.5-turbo-1106. Setting to { "type": "json_object" } enables JSON mode, which guarantees the message the model generates is valid JSON.`
				)
				.addText((text) => {
					text.setValue(
						`${viewSettings.chatSettings.openAI?.responseFormat}`
					);
					text.onChange((change) => {
						viewSettings.chatSettings.openAI!.responseFormat =
							change;
						this.plugin.saveSettings();
					});
				});

			const topP = new Setting(parentContainer)
				.setName("Top P")
				.setDesc(
					"Defaults to 1. An alternative to sampling with temperature, called nucleus sampling, where the model considers the results of the tokens with top_p probability mass. So 0.1 means only the tokens comprising the top 10% probability mass are considered."
				)
				.addText((text) => {
					text.setValue(`${viewSettings.chatSettings.openAI?.topP}`);
					text.inputEl.type = "number";
					text.onChange((change) => {
						viewSettings.chatSettings.openAI!.topP =
							parseFloat(change);
						this.plugin.saveSettings();
					});
				});
		}
	}

	generateTTSSettings(parentContainer: HTMLElement) {
		const settingType = getSettingType(this.viewType);
		const viewSettings = this.plugin.settings[settingType];
		const voices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
		const responseFormats = ["mp3", "opus", "aac", "flac", "pcm"];

		const voice = new Setting(parentContainer)
			.setName("Voice")
			.setDesc("The voice used in speech generation")
			.addDropdown((dropdown: DropdownComponent) => {
				voices.map((voice) =>
					dropdown.addOption(voice, voice.toUpperCase())
				);
				dropdown.onChange((change) => {
					viewSettings.speechSettings.voice = change;
					this.plugin.saveSettings();
				});
			});

		const responseFormat = new Setting(parentContainer)
			.setName("Response Format")
			.setDesc(
				"Defaults to mp3 The format to audio in. Supported formats are mp3, opus, aac, flac, wav, and pcm."
			)
			.addDropdown((dropdown: DropdownComponent) => {
				responseFormats.map((format) =>
					dropdown.addOption(format, format)
				);
				dropdown.onChange((change) => {
					viewSettings.speechSettings.responseFormat = change;
					this.plugin.saveSettings();
				});
			});

		const speed = new Setting(parentContainer)
			.setName("Speed")
			.setDesc(
				"The speed of the generated audio. Select a value from 0.25 to 4.0. 1.0 is the default."
			)
			.addText((text) => {
				text.setValue(`${viewSettings.speechSettings.speed}`);
				text.inputEl.type = "number";
				text.onChange((change) => {
					viewSettings.speechSettings.speed = parseFloat(change);
					this.plugin.saveSettings();
				});
			});
	}

	generateModerationsSettings(parentContainer: HTMLElement) { }
}
