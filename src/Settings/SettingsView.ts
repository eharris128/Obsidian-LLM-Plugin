import LLMPlugin from "main";
import {
	App,
	ButtonComponent,
	DropdownComponent,
	PluginSettingTab,
	Setting,
} from "obsidian";
import { changeDefaultModel, getGpt4AllPath } from "utils/utils";
import { models, modelNames } from "utils/models";
import { claudeSonnetJuneModel, openAIModel, geminiModel, GPT4All } from "utils/constants";
import logo from "assets/LLMguy.svg";
import { FAB } from "Plugin/FAB/FAB";

export default class SettingsView extends PluginSettingTab {
	plugin: LLMPlugin;
	fab: FAB;

	constructor(app: App, plugin: LLMPlugin, fab: FAB) {
		super(app, plugin);
		this.plugin = plugin;
		this.fab = fab;
	}
	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		// Adds reset history button
		new Setting(containerEl)
			.setName("Reset chat history")
			.setDesc("This will delete previous prompts and chat contexts")
			.addButton((button: ButtonComponent) => {
				button.setButtonText("Reset history");
				button.onClick(() => {
					this.plugin.history.reset();
				});
			});

		// Add Claude API key input
		new Setting(containerEl)
			.setName("Claude API key")
			.setDesc("Claude models require an API key for authentication.")
			.addText((text) => {
				let valueChanged = false;
				text.setValue(`${this.plugin.settings.claudeAPIKey}`);
				text.onChange((change) => {
					if (change.trim().length) {
						valueChanged = true;
						this.plugin.settings.claudeAPIKey = change;
					}
				});
			})
			.addButton((button: ButtonComponent) => {
				button.setButtonText("Generate token");
				button.onClick(() => {
					window.open("https://console.anthropic.com/settings/keys");
				});
			});

		// Adds Gemini API Key input
		new Setting(containerEl)
			.setName("Gemini API key")
			.setDesc("Gemini models require an API key for authentication.")
			.addText((text) => {
				let valueChanged = false;
				text.setValue(`${this.plugin.settings.geminiAPIKey}`);
				text.onChange((change) => {
					if (change.trim().length) {
						valueChanged = true;
						this.plugin.settings.geminiAPIKey = change;
					}
				});
			})
			.addButton((button: ButtonComponent) => {
				button.setButtonText("Generate token");
				button.onClick(() => {
					window.open("https://aistudio.google.com/app/apikey");
				});
			});

		// Adds OpenAI API Key input
		new Setting(containerEl)
			.setName("OpenAI API key")
			.setDesc("OpenAI models require an API key for authentication.")
			.addText((text) => {
				let valueChanged = false;
				text.setValue(`${this.plugin.settings.openAIAPIKey}`);
				text.onChange((change) => {
					if (change.trim().length) {
						valueChanged = true;
						this.plugin.settings.openAIAPIKey = change;
						this.plugin.saveSettings();
					}
				});
			})
			.addButton((button: ButtonComponent) => {
				button.setButtonText("Generate token");
				button.onClick((evt: MouseEvent) => {
					window.open("https://beta.openai.com/account/api-keys");
				});
			});

		// Add Default Model Selector
		new Setting(containerEl)
			.setClass('default-model-selector')
			.setName("Set default model")
			.setDesc("Sets the default LLM you want to use for the plugin")
			.addDropdown((dropdown: DropdownComponent) => {
				let valueChanged = false;
				dropdown.addOption(
					modelNames[this.plugin.settings.defaultModel],
					"Select default model"
				);
				let keys = Object.keys(models);
				for (let model of keys) {
					if (models[model].type === GPT4All) {
						const gpt4AllPath = getGpt4AllPath(this.plugin);
						const fullPath = `${gpt4AllPath}/${models[model].model}`;
						const exists = this.plugin.fileSystem.existsSync(fullPath);
						if (exists) {
							dropdown.addOption(models[model].model, model);
						}
					} else {
						dropdown.addOption(models[model].model, model);
					}
				}
				dropdown.onChange((change) => {
					valueChanged = true;
					changeDefaultModel(change, this.plugin)
				});
				dropdown.selectEl.addEventListener('blur', () => {
					if (valueChanged) {
						this.plugin.saveSettings();
						valueChanged = false; // Reset the flag after saving
					}
				});
				dropdown.setValue(this.plugin.settings.modalSettings.model);
			});

		// Add Toggle FAB button
		new Setting(containerEl)
			.setName("Toggle FAB")
			.setDesc("Toggles the LLM floating action button")
			.addToggle((value) => {
				value
					.setValue(this.plugin.settings.showFAB)
					.onChange(async (value) => {
						this.fab.removeFab();
						this.plugin.settings.showFAB = value;
						await this.plugin.saveSettings();
						if (value) {
							this.fab.regenerateFAB();
						}
					});
			});

		// Add donation button
		new Setting(containerEl)
			.setName("Donate")
			.setDesc("Consider donating to support development.")
			.addButton((button: ButtonComponent) => {
				button.setButtonText("Donate");
				button.onClick(() => {
					window.open("https://www.buymeacoffee.com/johnny1093");
				});
			});

		const llmGuy = containerEl.createDiv();
		llmGuy.addClass("llm-icon-wrapper");

		// Parse SVG string to DOM element
		const parser = new DOMParser();
		const svgDoc = parser.parseFromString(logo, "image/svg+xml");
		const svgElement = svgDoc.documentElement;

		// Append the SVG element
		llmGuy.appendChild(svgElement);

		const credits = llmGuy.createEl("div", {
			attr: {
				id: "llm-settings-credits"
			},

		});

		const creditsHeader = credits.createEl("p", {
			text: "LLM plugin",
			attr: {
				id: "llm-hero-credits"
			}
		});
		credits.appendChild(creditsHeader);
		const creditsNames = credits.createEl("p", {
			text: "By Johnny✨, Ryan Mahoney, and Evan Harris",
			attr: {
				class: "llm-hero-names llm-text-muted"
			}
		});
		credits.appendChild(creditsNames);
		const creditsVersion = credits.createEl("span", {
			text: `v${this.plugin.manifest.version}`,
			attr: {
				class: "llm-text-muted version"
			}
		});
		credits.appendChild(creditsVersion);
	}

}
