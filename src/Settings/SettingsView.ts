import LLMPlugin from "main";
import {
	App,
	ButtonComponent,
	DropdownComponent,
	PluginSettingTab,
	Setting,
	TextComponent,
} from "obsidian";
import { changeDefaultModel, getGpt4AllPath } from "utils/utils";
import { models, modelNames } from "utils/models";
import { GPT4All } from "utils/constants";
import logo from "assets/LLMguy.svg";
import { FAB } from "Plugin/FAB/FAB";

type APIKeyType = 'claude' | 'gemini' | 'openai';

interface APIKeyConfig {
	name: string;
	desc: string;
	key: keyof LLMPlugin['settings'];
	generateUrl: string;
}

export default class SettingsView extends PluginSettingTab {
	plugin: LLMPlugin;
	fab: FAB;
	private currentApiInput: TextComponent | null = null;
	private apiKeyConfigs: Record<APIKeyType, APIKeyConfig> = {
		claude: {
			name: "Claude API key",
			desc: "Claude models require an API key for authentication.",
			key: 'claudeAPIKey',
			generateUrl: "https://console.anthropic.com/settings/keys"
		},
		gemini: {
			name: "Gemini API key",
			desc: "Gemini models require an API key for authentication.",
			key: 'geminiAPIKey',
			generateUrl: "https://aistudio.google.com/app/apikey"
		},
		openai: {
			name: "OpenAI API key",
			desc: "OpenAI models require an API key for authentication.",
			key: 'openAIAPIKey',
			generateUrl: "https://platform.openai.com/api-keys"
		}
	};

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

		const apiKeySection = containerEl.createDiv();
		new Setting(apiKeySection)
			.setName("Manage API keys")
			.setDesc("Select which API key you want to view or modify")
			.addDropdown((dropdown) => {
				dropdown.addOption('', 'Select API to configure');
				Object.keys(this.apiKeyConfigs).forEach((key) => {
					dropdown.addOption(key, this.apiKeyConfigs[key as APIKeyType].name);
				});
				dropdown.onChange((value) => {
					this.showApiKeyInput(value as APIKeyType, apiKeySection);
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
						valueChanged = false;
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

		// Add Toggle File Context button
		new Setting(containerEl)
			.setName("Enable file context")
			.setDesc("Enable the file context feature that allows AI to access vault files. When disabled, AI will not have access to any files from your vault.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableFileContext)
					.onChange(async (value) => {
						this.plugin.settings.enableFileContext = value;
						await this.plugin.saveSettings();
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

		const parser = new DOMParser();
		const svgDoc = parser.parseFromString(logo, "image/svg+xml");
		const svgElement = svgDoc.documentElement;

		llmGuy.appendChild(svgElement);

		const credits = llmGuy.createEl("div", {
			attr: { id: "llm-settings-credits" }
		});

		const creditsHeader = credits.createEl("p", {
			text: "LLM plugin",
			attr: { id: "llm-hero-credits" }
		});
		credits.appendChild(creditsHeader);
		const creditsNames = credits.createEl("p", {
			text: "By Johnny✨, Ryan Mahoney, and Evan Harris",
			attr: { class: "llm-hero-names llm-text-muted" }
		});
		credits.appendChild(creditsNames);
		const creditsVersion = credits.createEl("span", {
			text: `v${this.plugin.manifest.version}`,
			attr: { class: "llm-text-muted version" }
		});
		credits.appendChild(creditsVersion);
	}

	private showApiKeyInput(type: APIKeyType, containerEl: HTMLElement) {
		const existingSettings = containerEl.querySelector('.api-key-input');
		if (existingSettings) {
			existingSettings.remove();
		}

		if (!type) return;

		const config = this.apiKeyConfigs[type];
		const settingContainer = containerEl.createDiv();
		settingContainer.addClass('api-key-input');

		new Setting(settingContainer)
			.setName(config.name)
			.setDesc(config.desc)
			.addText((text) => {
				this.currentApiInput = text;
				text.setValue(this.plugin.settings[config.key] as string);
				text.onChange((value) => {
					if (value.trim().length) {
						(this.plugin.settings[config.key] as string) = value;
						this.plugin.saveSettings();
					}
				});
			})
			.addButton((button: ButtonComponent) => {
				button.setButtonText("Generate token");
				button.onClick(() => {
					window.open(config.generateUrl);
				});
			});
	}
}
