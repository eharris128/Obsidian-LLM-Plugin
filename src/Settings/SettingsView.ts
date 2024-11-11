import { Platform } from "obsidian";
import LLMPlugin from "main";
import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	PluginSettingTab,
	Setting,
} from "obsidian";
import { DEFAULT_DIRECTORY, changeDefaultModel } from "utils/utils";
import { models, modelNames } from "utils/models";
import { claudeSonnetJuneModel, openAIModel, geminiModel, GPT4All } from "utils/constants";
import logo from "assets/LLMguy.svg";
import { FAB } from "Plugin/FAB/FAB";
const fs = !Platform.isMobile ? require("fs") : null;

// TODO - abstract to its own component file.
class DefaultModelModal extends Modal {
	plugin: LLMPlugin;
	private defaultModel: string;

	constructor(app: App, defaultModel: string, plugin: LLMPlugin) {
		super(app);
		this.defaultModel = defaultModel;
		this.plugin = plugin
	}

	handleChangeDefaultModel() {
		changeDefaultModel(this.defaultModel, this.plugin);
		const defaultModelSelector = document.querySelector('.default-model-selector > .setting-item-control > .dropdown') as HTMLSelectElement;
		defaultModelSelector.value = this.defaultModel
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty(); // Clear existing content if needed

		// Create the modal content
		contentEl.createEl('h2', { text: 'Set Model as Default' });
		contentEl.createEl('p', { text: 'Would you like to set this model as your default model?' });

		// Create the interactive button
		const yesButton = contentEl.createEl('button', { text: 'Yes' });
		yesButton.onclick = () => {
			this.handleChangeDefaultModel()
			new Notice('Model set as default!');
			this.close(); // Close the modal after the action
		};

		// User elects to not save the model as default
		const noButton = contentEl.createEl('button', { text: 'No' });
		noButton.style.marginLeft = '16px';
		noButton.onclick = () => {
			new Notice('API key saved');
			this.close(); // Close the modal after the action
		};
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty(); // Clear content when the modal is closed
	}
}

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
			.setName("Reset Chat History")
			.setDesc("This will delete previous Prompts and Chat Contexts")
			.addButton((button: ButtonComponent) => {
				button.setButtonText("Reset History");
				button.onClick(() => {
					this.plugin.history.reset();
				});
			});

		// Add Claude API key input
		new Setting(containerEl)
			.setName("Claude API Key")
			.setDesc("Claude models require an API key for authentication.")
			.addText((text) => {
				let valueChanged = false;
				text.setValue(`${this.plugin.settings.claudeAPIKey}`);
				text.onChange((change) => {
					valueChanged = true;
					this.plugin.settings.claudeAPIKey = change;
				});
				// Handle blur event (when the user finishes editing)
				text.inputEl.addEventListener('blur', () => {
					if (valueChanged) {
						new DefaultModelModal(this.app, claudeSonnetJuneModel, this.plugin).open(); // Show the modal
						this.plugin.saveSettings();
						valueChanged = false; // Reset the flag after saving
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
			.setName("Gemini API Key")
			.setDesc("Gemini models require an API key for authentication.")
			.addText((text) => {
				let valueChanged = false;
				text.setValue(`${this.plugin.settings.geminiAPIKey}`);
				text.onChange((change) => {
					valueChanged = true;
					this.plugin.settings.geminiAPIKey = change;
				});
				// Handle blur event (when the user finishes editing)
				text.inputEl.addEventListener('blur', () => {
					if (valueChanged) {
						new DefaultModelModal(this.app, geminiModel, this.plugin).open(); // Show the modal
						this.plugin.saveSettings();
						valueChanged = false; // Reset the flag after saving
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
			.setName("OpenAI API Key")
			.setDesc("OpenAI models require an API key for authentication.")
			.addText((text) => {
				let valueChanged = false;
				text.setValue(`${this.plugin.settings.openAIAPIKey}`);
				text.onChange((change) => {
					valueChanged = true;
					this.plugin.settings.openAIAPIKey = change;
					this.plugin.saveSettings();
				});
				// Handle blur event (when the user finishes editing)
				text.inputEl.addEventListener('blur', () => {
					if (valueChanged) {
						new DefaultModelModal(this.app, openAIModel, this.plugin).open(); // Show the modal
						this.plugin.saveSettings();
						valueChanged = false; // Reset the flag after saving
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
			.setName("Set Default Model")
			.setDesc("Sets the default LLM you want to use for the plugin")
			.addDropdown((dropdown: DropdownComponent) => {
				let valueChanged = false;
				dropdown.addOption(
					modelNames[this.plugin.settings.defaultModel],
					"Select Default Model"
				);
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
		llmGuy.addClass("icon-wrapper");
		llmGuy.innerHTML = logo;
		const credits = llmGuy.createDiv();
		credits.id = "settings-credits";
		credits.innerHTML =
			`<div>
			<h2 id="hero-credits">LLM Plugin</h2>\n<p class="hero-names text-muted">By Johnny✨ and Ryan Mahoney </p>
			<span class="text-muted version">v${this.plugin.manifest.version}</span>
			</div>
			`;
	}

}
