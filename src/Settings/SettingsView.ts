import LLMPlugin from "main";
import {
	App,
	ButtonComponent,
	PluginSettingTab,
	Setting,
} from "obsidian";
import logo from "assets/LLM-Squad.svg";
import { FAB } from "Plugin/FAB/FAB";
import { LLMSettingsModal } from "Settings/LLMSettingsModal";

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

		// Open settings button — launches the dedicated settings modal
		new Setting(containerEl)
			.setName("Plugin settings")
			.setDesc("Open the dedicated settings panel with all configuration options.")
			.addButton((button: ButtonComponent) => {
				button.setButtonText("Open settings");
				button.setCta();
				button.onClick(() => {
					new LLMSettingsModal(this.app, this.plugin, this.fab).open();
				});
			});

		new Setting(containerEl)
			.setName("Support development")
			.setDesc("Consider donating to support ongoing development.")
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

		const credits = llmGuy.createDiv({
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
		const creditsVersion = credits.createSpan({
			text: `v${this.plugin.manifest.version}`,
			attr: { class: "llm-text-muted version" }
		});
		credits.appendChild(creditsVersion);
	}

}
