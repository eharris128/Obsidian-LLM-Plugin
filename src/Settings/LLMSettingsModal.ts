import LLMPlugin from "main";
import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	Setting,
	setIcon,
} from "obsidian";
import { changeDefaultModel, fetchOllamaModels, fetchLMStudioModels, getGpt4AllPath } from "utils/utils";
import { buildOllamaModels, buildLMStudioModels, modelNames, models } from "utils/models";
import { GPT4All, ollama, lmStudio } from "utils/constants";
import { FAB } from "Plugin/FAB/FAB";
import { ChatModal2 } from "Plugin/Modal/ChatModal2";
import { DEFAULT_EMBEDDING_MODELS, EmbeddingProvider, OllamaModelNotFoundError } from "RAG/EmbeddingService";
import { ALL_TOOL_DEFINITIONS } from "services/ObsidianToolRegistry";

type APIKeyType = "claude" | "gemini" | "openai" | "mistral";

interface APIKeyConfig {
	name: string;
	desc: string;
	key: keyof LLMPlugin["settings"];
	generateUrl: string;
}

interface NavSection {
	id: string;
	label: string;
	items: NavItem[];
}

interface NavItem {
	id: string;
	label: string;
	icon: string;
}

export class LLMSettingsModal extends Modal {
	plugin: LLMPlugin;
	fab: FAB;
	private activeTab = "general";
	private mainContentEl: HTMLElement;

	private readonly apiKeyConfigs: Record<APIKeyType, APIKeyConfig> = {
		claude: {
			name: "Claude API key",
			desc: "Claude models require an API key for authentication.",
			key: "claudeAPIKey",
			generateUrl: "https://console.anthropic.com/settings/keys",
		},
		gemini: {
			name: "Gemini API key",
			desc: "Gemini models require an API key for authentication.",
			key: "geminiAPIKey",
			generateUrl: "https://aistudio.google.com/app/apikey",
		},
		openai: {
			name: "OpenAI API key",
			desc: "OpenAI models require an API key for authentication.",
			key: "openAIAPIKey",
			generateUrl: "https://platform.openai.com/api-keys",
		},
		mistral: {
			name: "Mistral API key",
			desc: "Mistral AI models require an API key for authentication.",
			key: "mistralAPIKey",
			generateUrl: "https://console.mistral.ai/api-keys",
		},
	};

	private readonly navSections: NavSection[] = [
		{
			id: "core",
			label: "Core Settings",
			items: [
				{ id: "general",        label: "General",        icon: "settings" },
				{ id: "obsidian-agent", label: "Obsidian Agent",  icon: "stone" },
				{ id: "interface",      label: "Interface",       icon: "layout-dashboard" },
				{ id: "chat",           label: "Chat",            icon: "message-square" },
				{ id: "tools",          label: "Tools",           icon: "wrench" },
				{ id: "skills",         label: "Skills",          icon: "scroll-text" },
				{ id: "memory",         label: "Memory",          icon: "brain" },
				{ id: "projects",       label: "Projects",        icon: "folder-open" },
				{ id: "assistants",     label: "Assistants",      icon: "bot" },
			],
		},
		{
			id: "model-providers",
			label: "Model Providers",
			items: [
				{ id: "anthropic",    label: "Anthropic",    icon: "bot" },
				{ id: "openai",       label: "OpenAI",       icon: "sparkles" },
				{ id: "gemini",       label: "Gemini",       icon: "gem" },
				{ id: "mistral",      label: "Mistral",      icon: "wind" },
				{ id: "ollama",       label: "Ollama",       icon: "cpu" },
				{ id: "lmstudio",     label: "LM Studio",   icon: "monitor" },
			],
		},
		{
			id: "features",
			label: "Features",
			items: [
				{ id: "vault-search", label: "Vault Search", icon: "search" },
			],
		},
	];

	private coreModalEl: HTMLElement | null = null;
	private resizeHandler: (() => void) | null = null;
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

	constructor(app: App, plugin: LLMPlugin, fab: FAB) {
		super(app);
		this.plugin = plugin;
		this.fab = fab;
	}

	/** Pin our modal to the exact same rect as the core settings modal. */
	private matchCoreModal() {
		if (!this.coreModalEl) return;
		const { top, left, right, bottom } = this.coreModalEl.getBoundingClientRect();
		// Inline styles beat any CSS rule regardless of specificity.
		Object.assign(this.modalEl.style, {
			position:  "fixed",
			top:       `${top}px`,
			left:      `${left}px`,
			right:     `${window.innerWidth - right}px`,
			bottom:    `${window.innerHeight - bottom}px`,
			width:     "auto",
			height:    "auto",
			maxWidth:  "none",
			maxHeight: "none",
			minWidth:  "0",
			minHeight: "0",
			transform: "none",
			margin:    "0",
			boxShadow: "none",   // inline beats .modal-container.mod-dim .modal specificity
		});
	}

	onOpen() {
		const { modalEl } = this;
		modalEl.addClass("llm-dedicated-settings-modal");

		// Resolve the core settings modal element once.
		const appSetting = (this.app as any).setting;
		this.coreModalEl =
			appSetting?.containerEl?.closest?.(".modal") ??
			document.querySelector<HTMLElement>(".modal-container.mod-settings .modal") ??
			Array.from(document.querySelectorAll<HTMLElement>(".modal-container .modal"))
				.find((el) => el !== modalEl && !el.contains(modalEl)) ??
			null;

		// Hide our scrim so we look like part of the core settings panel.
		const modalBg = modalEl.closest(".modal-container")
			?.querySelector<HTMLElement>(".modal-bg");
		if (modalBg) modalBg.style.display = "none";

		// Apply sizing now and on every window resize.
		this.matchCoreModal();
		this.resizeHandler = () => this.matchCoreModal();
		window.addEventListener("resize", this.resizeHandler);

		// Close when the user clicks outside the modal. We defer registration by
		// one tick so the click that opened the modal doesn't immediately close it.
		this.outsideClickHandler = (e: MouseEvent) => {
			if (!this.modalEl.contains(e.target as Node)) {
				this.close();
			}
		};
		setTimeout(() => {
			document.addEventListener("mousedown", this.outsideClickHandler!);
		}, 0);

		// mod-sidebar-layout tells Obsidian's CSS to apply the two-column layout.
		modalEl.addClass("mod-sidebar-layout");

		this.contentEl.empty();
		// vertical-tabs-container is the flex wrapper Obsidian uses in its own settings.
		this.contentEl.addClass("vertical-tabs-container");

		// Sidebar — uses Obsidian's own vertical tab header classes.
		const sidebar = this.contentEl.createDiv("vertical-tab-header");
		this.buildSidebar(sidebar);

		// Content area — Obsidian's classes handle layout, scrolling, and padding.
		const contentContainer = this.contentEl.createDiv("vertical-tab-content-container");
		this.mainContentEl = contentContainer.createDiv("vertical-tab-content");
		this.renderTab(this.activeTab);
	}

	onClose() {
		if (this.resizeHandler) {
			window.removeEventListener("resize", this.resizeHandler);
			this.resizeHandler = null;
		}
		if (this.outsideClickHandler) {
			document.removeEventListener("mousedown", this.outsideClickHandler);
			this.outsideClickHandler = null;
		}
		this.contentEl.empty();
	}

	private buildSidebar(sidebar: HTMLElement) {
		for (const section of this.navSections) {
			const groupEl = sidebar.createDiv("vertical-tab-header-group");
			groupEl.createDiv({
				cls:  "vertical-tab-header-group-title",
				text: section.label,
			});

			// vertical-tab-header-group-items is the core container for items.
			const itemsEl = groupEl.createDiv("vertical-tab-header-group-items");

			for (const item of section.items) {
				const isActive = item.id === this.activeTab;
				// vertical-tab-nav-item + tappable are the core nav item classes.
				const itemEl = itemsEl.createDiv({
					cls: `vertical-tab-nav-item tappable${isActive ? " is-active" : ""}`,
				});

				// Only show icons for Core Settings tabs.
				if (section.id === "core") {
					const iconEl = itemEl.createDiv("vertical-tab-nav-item-icon");
					setIcon(iconEl, item.icon);
				}

				itemEl.createSpan({ text: item.label });

				itemEl.addEventListener("click", () => {
					sidebar
						.querySelectorAll(".vertical-tab-nav-item")
						.forEach((el) => el.removeClass("is-active"));
					itemEl.addClass("is-active");
					this.activeTab = item.id;
					this.renderTab(item.id);
				});
			}
		}
	}

	private renderTab(tabId: string) {
		this.mainContentEl.empty();
		switch (tabId) {
			case "general":       this.renderGeneral();     break;
			case "interface":     this.renderInterface();   break;
			case "anthropic":     this.renderAnthropic();   break;
			case "openai":        this.renderOpenAI();      break;
			case "gemini":        this.renderGemini();      break;
			case "mistral":       this.renderMistral();     break;
			case "ollama":        this.renderOllama();      break;
			case "lmstudio":      this.renderLMStudio();    break;
			case "chat":          this.renderChat();         break;
			case "tools":         this.renderTools();        break;
			case "vault-search":  this.renderVaultSearch();  break;
			case "skills":        this.renderSkills();        break;
			case "memory":        this.renderMemory();        break;
			case "projects":      this.renderProjects();      break;
			case "assistants":      this.renderAssistants();      break;
			case "obsidian-agent":  this.renderObsidianAgent();   break;
		}
	}

	// ── Tab renderers ──────────────────────────────────────────────────────────

	private renderGeneral() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "General");
		const items = this.addSettingGroup(el);

		// Default model or assistant
		new Setting(items)
			.setName("Default model or assistant")
			.setDesc("Sets the default LLM or assistant used across the plugin.")
			.addDropdown((dropdown: DropdownComponent) => {
				const ollamaBuilt = buildOllamaModels(this.plugin.settings.ollamaModels);
				const lmStudioBuilt = buildLMStudioModels(this.plugin.settings.lmStudioModels);
				const allModels = { ...models, ...ollamaBuilt.models, ...lmStudioBuilt.models };
				const allModelNames = { ...modelNames, ...ollamaBuilt.names, ...lmStudioBuilt.names };

				// ── Models optgroup ───────────────────────────────────────────
				const modelsGroup = document.createElement("optgroup");
				modelsGroup.label = "Models";
				for (const model of Object.keys(allModels)) {
					const type = allModels[model].type;
					if (type === ollama || type === lmStudio) {
						const opt = document.createElement("option");
						opt.value = allModels[model].model;
						opt.text = model;
						modelsGroup.appendChild(opt);
						continue;
					}
					if (type === GPT4All) {
						const fullPath = `${getGpt4AllPath(this.plugin)}/${allModels[model].model}`;
						if (this.plugin.fileSystem.existsSync(fullPath)) {
							const opt = document.createElement("option");
							opt.value = allModels[model].model;
							opt.text = model;
							modelsGroup.appendChild(opt);
						}
						continue;
					}
					const opt = document.createElement("option");
					opt.value = allModels[model].model;
					opt.text = model;
					modelsGroup.appendChild(opt);
				}
				dropdown.selectEl.appendChild(modelsGroup);

				// ── Assistants optgroup (includes built-in Obsidian Agent) ───────
				const assistants = this.plugin.assistantManager?.getAssistants() ?? [];
				const agentEnabled = this.plugin.settings.obsidianAgentSettings?.enabled;
				if (agentEnabled || assistants.length > 0) {
					const assistantsGroup = document.createElement("optgroup");
					assistantsGroup.label = "Assistants";
					// Obsidian Agent pinned first, only when the feature is enabled
					if (agentEnabled) {
						const agentOpt = document.createElement("option");
						agentOpt.value = "agent:obsidian";
						agentOpt.text = "Obsidian Agent";
						assistantsGroup.appendChild(agentOpt);
					}
					for (const assistant of assistants) {
						const opt = document.createElement("option");
						opt.value = `assistant:${assistant.id}`;
						opt.text = assistant.name;
						assistantsGroup.appendChild(opt);
					}
					dropdown.selectEl.appendChild(assistantsGroup);
				}

				// Set initial value — agent mode > active assistant > current model
				const activeAssistantId = this.plugin.settings.assistantSettings?.activeAssistantId;
				if (this.plugin.settings.defaultAgentMode) {
					dropdown.selectEl.value = "agent:obsidian";
				} else if (activeAssistantId) {
					dropdown.selectEl.value = `assistant:${activeAssistantId}`;
				} else {
					dropdown.selectEl.value = this.plugin.settings.modalSettings.model;
				}

				dropdown.onChange((change) => {
					if (change === "agent:obsidian") {
						// ── Obsidian Agent selected ───────────────────────────
						this.plugin.settings.defaultAgentMode = true;
						if (this.plugin.settings.assistantSettings?.activeAssistantId) {
							this.plugin.settings.assistantSettings = {
								...this.plugin.settings.assistantSettings,
								activeAssistantId: null,
							};
						}
						this.plugin.saveSettings();
						this.plugin.syncAllContainersAgentMode(true);
						return;
					} else if (change.startsWith("assistant:")) {
						// ── Assistant selected ────────────────────────────────
						this.plugin.settings.defaultAgentMode = false;
						const assistantId = change.slice("assistant:".length);
						const assistant = this.plugin.assistantManager?.getAssistant(assistantId);
						if (!assistant) return;
						this.plugin.settings.assistantSettings = {
							...this.plugin.settings.assistantSettings,
							activeAssistantId: assistantId,
						};
						// If the assistant has a preferred model, also update the default model
						if (assistant.preferredModel && allModelNames[assistant.preferredModel]) {
							const name = allModelNames[assistant.preferredModel];
							if (allModels[name]?.type === ollama || allModels[name]?.type === lmStudio) {
								models[name] = allModels[name];
								modelNames[assistant.preferredModel] = name;
							}
							changeDefaultModel(assistant.preferredModel, this.plugin);
						}
						this.plugin.syncAllContainersAgentMode(false);
					} else {
						// ── Model selected — clear active assistant + agent mode ─
						this.plugin.settings.defaultAgentMode = false;
						const name = allModelNames[change];
						if (name && (allModels[name]?.type === ollama || allModels[name]?.type === lmStudio)) {
							models[name] = allModels[name];
							modelNames[change] = name;
						}
						if (this.plugin.settings.assistantSettings?.activeAssistantId) {
							this.plugin.settings.assistantSettings = {
								...this.plugin.settings.assistantSettings,
								activeAssistantId: null,
							};
						}
						changeDefaultModel(change, this.plugin);
						this.plugin.syncAllContainersAgentMode(false);
					}
					this.plugin.saveSettings();
					// Sync all view dropdowns to reflect the new default
					this.plugin.syncAllModelDropdowns();
				});
			});

		// Empty chat avatar
		new Setting(items)
			.setName("Empty chat avatar")
			.setDesc("Choose which avatar to display on empty/new chats.")
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption("llm-gal", "LLM Gal");
				dropdown.addOption("llm-guy", "LLM Guy");
				dropdown.addOption("zen-kid", "Zen Kid");
				dropdown.addOption("ninja-cat", "Ninja Cat");
				dropdown.setValue(this.plugin.settings.emptyChatAvatar || "llm-gal");
				dropdown.onChange(async (value) => {
					this.plugin.settings.emptyChatAvatar = value;
					await this.plugin.saveSettings();
					this.plugin.refreshAllEmptyStates();
				});
			});

		// Root vault folder
		new Setting(items)
			.setName("Root vault folder")
			.setDesc(
				"Vault folder used as the root for all AI feature data. " +
				"Skills live at <root>/Skills, with future features (Assistants, Projects, Memories, Chats) " +
				"following the same pattern."
			)
			.addText((text) => {
				text.setPlaceholder("AI");
				text.setValue(this.plugin.settings.rootVaultFolder ?? "AI");
				text.onChange(async (value) => {
					this.plugin.settings.rootVaultFolder = value.trim() || "AI";
					await this.plugin.saveSettings();
					await this.plugin.reinitSkillRegistry();
					await this.plugin.reinitProjectManager();
					await this.plugin.reinitAssistantManager();
				});
			});
	}

	private renderInterface() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Interface");
		const items = this.addSettingGroup(el);

		new Setting(items)
			.setName("Floating Action Button (FAB)")
			.setDesc("Show the floating action button for quick access to the chat.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showFAB)
					.onChange(async (value) => {
						this.fab.removeFab();
						this.plugin.settings.showFAB = value;
						await this.plugin.saveSettings();
						if (value) this.fab.regenerateFAB();
					});
			});

		new Setting(items)
			.setName("Ask AI in status bar")
			.setDesc(
				"Shows an 'Ask AI' button in the status bar that opens the chat popover."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showStatusBarButton)
					.onChange(async (value) => {
						this.plugin.settings.showStatusBarButton = value;
						await this.plugin.saveSettings();
						if (value) {
							this.plugin.statusBarButton.generate();
							this.plugin.recentChatsButton.generate();
						} else {
							this.plugin.statusBarButton.remove();
							this.plugin.recentChatsButton.remove();
						}
					});
			});

		new Setting(items)
			.setName("Ribbon icon")
			.setDesc("Show the 'Ask a question' icon in the ribbon bar.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showRibbonIcon)
					.onChange(async (value) => {
						this.plugin.settings.showRibbonIcon = value;
						await this.plugin.saveSettings();
						if (value && !this.plugin.ribbonIconEl) {
							this.plugin.ribbonIconEl = this.plugin.addRibbonIcon(
								"bot",
								"Ask a question",
								() => {
									new ChatModal2(this.plugin).open();
								}
							);
						} else if (!value && this.plugin.ribbonIconEl) {
							this.plugin.ribbonIconEl.remove();
							this.plugin.ribbonIconEl = null;
						}
					});
			});
	}

	private renderApiKeyField(items: HTMLElement, config: APIKeyConfig) {
		new Setting(items)
			.setName(config.name)
			.setDesc(config.desc)
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(this.plugin.settings[config.key] as string);
				text.onChange((value) => {
					if (value.trim().length) {
						(this.plugin.settings[config.key] as string) = value;
						this.plugin.saveSettings();
					}
				});
			})
			.addButton((button: ButtonComponent) => {
				button.setButtonText("Generate");
				button.onClick(() => window.open(config.generateUrl));
			});
	}

	private renderAnthropic() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Anthropic");

		// API key
		const apiItems = this.addSettingGroup(el);
		this.renderApiKeyField(apiItems, this.apiKeyConfigs.claude);

		// Claude Code
		const authItems = this.addSettingGroup(el, "Claude Code");
		new Setting(authItems)
			.setName("Claude Code OAuth token")
			.setDesc("OAuth token for authenticating with Claude Code (CLAUDE_CODE_OAUTH_TOKEN).")
			.addText((text) => {
				text.inputEl.type = "password";
				text.setValue(this.plugin.settings.claudeCodeOAuthToken);
				text.onChange((value) => {
					this.plugin.settings.claudeCodeOAuthToken = value;
					this.plugin.saveSettings();
				});
			});

		// Linear workspaces
		const workspaceItems = this.addSettingGroup(el, "Linear Workspaces");
		const workspaceListEl = workspaceItems.createDiv({ cls: "linear-workspace-list" });
		this.renderWorkspaceList(workspaceListEl);
		const addWorkspaceSetting = new Setting(workspaceItems)
			.setName("Add workspace")
			.addButton((button) => {
				button.setButtonText("+ Add Linear workspace");
				button.onClick(() => {
					this.plugin.settings.linearWorkspaces.push({ name: "", apiKey: "" });
					this.plugin.saveSettings();
					this.renderWorkspaceList(workspaceListEl);
				});
			});
		const addDesc = addWorkspaceSetting.descEl;
		addDesc.appendText("Add Linear workspaces with their ");
		addDesc.createEl("a", { text: "API keys", href: "https://linear.app/settings/account/security" });
		addDesc.appendText(". Each workspace gets its own MCP server.");
	}

	private renderOpenAI() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "OpenAI");
		const items = this.addSettingGroup(el);
		this.renderApiKeyField(items, this.apiKeyConfigs.openai);
	}

	private renderGemini() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Gemini");
		const items = this.addSettingGroup(el);
		this.renderApiKeyField(items, this.apiKeyConfigs.gemini);
	}

	private renderMistral() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Mistral");
		const items = this.addSettingGroup(el);
		this.renderApiKeyField(items, this.apiKeyConfigs.mistral);
	}

	private renderOllama() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Ollama");
		const items = this.addSettingGroup(el);

		new Setting(items)
			.setName("Ollama host")
			.setDesc("URL of your Ollama server (default: http://localhost:11434).")
			.addText((text) => {
				text.setPlaceholder("http://localhost:11434");
				text.setValue(this.plugin.settings.ollamaHost);
				text.onChange((value) => {
					this.plugin.settings.ollamaHost = value;
					this.plugin.saveSettings();
				});
			});

		// Discovered models list — shown between the two settings in the group.
		const modelListEl = items.createEl("p", {
			cls: "setting-item-description llm-settings-ollama-models",
		});
		if (this.plugin.settings.ollamaModels.length > 0) {
			modelListEl.setText(
				`Discovered models: ${this.plugin.settings.ollamaModels.join(", ")}`
			);
		}

		new Setting(items)
			.setName("Refresh models")
			.setDesc("Fetch available models from your Ollama server.")
			.addButton((button) => {
				button.setButtonText("Refresh");
				button.onClick(async () => {
					try {
						button.setButtonText("Fetching...");
						button.setDisabled(true);
						const foundModels = await fetchOllamaModels(
							this.plugin.settings.ollamaHost
						);
						this.plugin.settings.ollamaModels = foundModels;
						const built = buildOllamaModels(foundModels);
						Object.assign(models, built.models);
						Object.assign(modelNames, built.names);
						await this.plugin.saveSettings();
						this.renderTab("ollama");
					} catch {
						modelListEl.setText(
							"Failed to connect to Ollama. Is it running?"
						);
						button.setButtonText("Refresh");
						button.setDisabled(false);
					}
				});
			});
	}

	private renderLMStudio() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "LM Studio");
		const items = this.addSettingGroup(el);

		new Setting(items)
			.setName("LM Studio host")
			.setDesc("URL of your LM Studio server (default: http://localhost:1234).")
			.addText((text) => {
				text.setPlaceholder("http://localhost:1234");
				text.setValue(this.plugin.settings.lmStudioHost);
				text.onChange((value) => {
					this.plugin.settings.lmStudioHost = value;
					this.plugin.saveSettings();
				});
			});

		const modelListEl = items.createEl("p", {
			cls: "setting-item-description llm-settings-ollama-models",
		});
		if (this.plugin.settings.lmStudioModels.length > 0) {
			modelListEl.setText(
				`Discovered models: ${this.plugin.settings.lmStudioModels.join(", ")}`
			);
		}

		new Setting(items)
			.setName("Refresh models")
			.setDesc("Fetch available models from your LM Studio server.")
			.addButton((button) => {
				button.setButtonText("Refresh");
				button.onClick(async () => {
					try {
						button.setButtonText("Fetching...");
						button.setDisabled(true);
						const foundModels = await fetchLMStudioModels(
							this.plugin.settings.lmStudioHost
						);
						this.plugin.settings.lmStudioModels = foundModels;
						const built = buildLMStudioModels(foundModels);
						Object.assign(models, built.models);
						Object.assign(modelNames, built.names);
						await this.plugin.saveSettings();
						this.renderTab("lmstudio");
					} catch {
						modelListEl.setText(
							"Failed to connect to LM Studio. Is the local server running?"
						);
						button.setButtonText("Refresh");
						button.setDisabled(false);
					}
				});
			});
	}

	private renderChat() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Chat");

		// File context
		const contextItems = this.addSettingGroup(el);
		new Setting(contextItems)
			.setName("Enable file context")
			.setDesc(
				"Allow AI to access vault files. When disabled, the AI will not have access to any files from your vault."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableFileContext)
					.onChange(async (value) => {
						this.plugin.settings.enableFileContext = value;
						await this.plugin.saveSettings();
					});
			});

		// History
		const mainItems = this.addSettingGroup(el, "History");

		new Setting(mainItems)
			.setName("Save chats as markdown files")
			.setDesc(
				"Store each conversation as a .md file in your vault. Enables Obsidian search, tags, and backlinks on your chat history."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.chatHistoryEnabled)
					.onChange(async (value) => {
						this.plugin.settings.chatHistoryEnabled = value;
						await this.plugin.saveSettings();
						renderHistorySection();
					});
			});

		new Setting(mainItems)
			.setName("Reset chat history")
			.setDesc("Delete all previous prompts and chat contexts.")
			.addButton((button: ButtonComponent) => {
				button.setButtonText("Reset history");
				button.setWarning();
				button.onClick(() => {
					this.plugin.history.reset();
				});
			});

		// Dynamic section (folder + migration) — own group that re-renders on toggle.
		const migrationGroup = el.createDiv("setting-group");
		const migrationEl = migrationGroup.createDiv("setting-items");

		const renderHistorySection = () => {
			migrationEl.empty();
			if (!this.plugin.settings.chatHistoryEnabled) {
				migrationGroup.style.display = "none";
				return;
			}
			migrationGroup.style.display = "";

			new Setting(migrationEl)
				.setName("History folder")
				.setDesc("Vault folder where chat files will be saved.")
				.addText((text) => {
					text.setPlaceholder("LLM Chats");
					text.setValue(this.plugin.settings.chatHistoryFolder);
					text.onChange(async (value) => {
						this.plugin.settings.chatHistoryFolder = value.trim() || "LLM Chats";
						await this.plugin.saveSettings();
					});
				});

			if (
				!this.plugin.settings.chatHistoryMigrated &&
				this.plugin.settings.promptHistory.length > 0
			) {
				new Setting(migrationEl)
					.setName("Migrate existing history")
					.setDesc(
						`You have ${this.plugin.settings.promptHistory.length} saved conversation(s) in the old format. Click to convert them to markdown files.`
					)
					.addButton((button) => {
						button.setButtonText("Migrate now");
						button.setCta();
						button.onClick(async () => {
							button.setButtonText("Migrating…");
							button.setDisabled(true);
							await this.plugin.chatHistory.migrate(
								this.plugin.settings.promptHistory
							);
							this.plugin.settings.chatHistoryMigrated = true;
							await this.plugin.saveSettings();
							new Notice("✓ Legacy history has been migrated.");
							renderHistorySection();
						});
					});
			}
		};

		renderHistorySection();
	}

	private renderTools() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Tools");

		// Ensure toolSettings exists (deep-merge guard for existing installs)
		if (!this.plugin.settings.toolSettings) {
			this.plugin.settings.toolSettings = { disabledTools: [], maxToolCalls: 10 };
		}

		// ── Agent behaviour ───────────────────────────────────────────────────
		const behaviourItems = this.addSettingGroup(el, "Agent Behaviour");

		new Setting(behaviourItems)
			.setName("Permission mode")
			.setDesc(
				"Controls when the agent asks for your approval before performing actions in your vault."
			)
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption("ask", "Ask — approve writes, auto-allow reads");
				dropdown.addOption("auto-approve", "Auto-approve all (no prompts)");
				dropdown.addOption("ask-everything", "Ask for everything");
				dropdown.addOption("read-only", "Read-only (deny any writes)");

				const currentMode =
					this.plugin.settings.modalSettings.agentSettings?.permissionMode ?? "ask";
				dropdown.setValue(currentMode);

				dropdown.onChange(async (value) => {
					const mode = value as import("../Types/types").PermissionMode;
					this.plugin.settings.modalSettings.agentSettings = { permissionMode: mode };
					this.plugin.settings.widgetSettings.agentSettings = { permissionMode: mode };
					this.plugin.settings.fabSettings.agentSettings = { permissionMode: mode };
					await this.plugin.saveSettings();
				});
			});

		new Setting(behaviourItems)
			.setName("Max tool calls per turn")
			.setDesc(
				"Maximum number of tool-call/execute cycles the agent can run in a single response before stopping. Prevents runaway loops (1–25)."
			)
			.addSlider((slider) => {
				slider
					.setLimits(1, 25, 1)
					.setValue(this.plugin.settings.toolSettings.maxToolCalls ?? 10)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.toolSettings.maxToolCalls = value;
						await this.plugin.saveSettings();
					});
			});

		// ── Available tools ───────────────────────────────────────────────────
		const toolsItems = this.addSettingGroup(el, "Available Tools");

		toolsItems.createDiv({
			cls: "setting-item-description",
			text: "Disable tools you don't want the AI to use. Disabled tools are never offered to the model, regardless of permission mode or active skill.",
		});

		const ragEnabled = this.plugin.settings.ragSettings?.enabled ?? false;
		const disabledTools = this.plugin.settings.toolSettings.disabledTools;

		for (const tool of ALL_TOOL_DEFINITIONS) {
			const setting = new Setting(toolsItems);

			// Build the name element: risk badge + display name
			const nameFragment = document.createDocumentFragment();
			const badge = nameFragment.createEl("span", {
				cls: `llm-tool-badge llm-tool-badge-${tool.risk}`,
				text: tool.risk,
			});
			nameFragment.appendChild(badge);
			nameFragment.appendChild(document.createTextNode(" " + tool.displayName));
			setting.nameEl.appendChild(nameFragment);

			// Description: tool description + optional dependency note
			let desc = tool.description;
			if (tool.requiresRag && !ragEnabled) {
				desc += " ⚠ Requires Vault Search to be enabled.";
			}
			setting.setDesc(desc);

			// The tool name in small muted text below the description
			const codeEl = setting.descEl.createEl("div", {
				cls: "llm-tool-name-code",
				text: tool.name,
			});
			setting.descEl.appendChild(codeEl);

			setting.addToggle((toggle) => {
				toggle.setValue(!disabledTools.includes(tool.name));
				toggle.onChange(async (enabled) => {
					const idx = this.plugin.settings.toolSettings.disabledTools.indexOf(tool.name);
					if (enabled && idx !== -1) {
						this.plugin.settings.toolSettings.disabledTools.splice(idx, 1);
					} else if (!enabled && idx === -1) {
						this.plugin.settings.toolSettings.disabledTools.push(tool.name);
					}
					await this.plugin.saveSettings();
				});
			});
		}
	}

	private renderVaultSearch() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Vault Search");

		// Enable toggle
		const toggleItems = this.addSettingGroup(el);
		new Setting(toggleItems)
			.setName("Enable vault search (RAG)")
			.setDesc(
				"Index your vault and allow the AI to semantically search your notes. " +
				"Tool-capable models (Claude, GPT-4, Gemini) use this automatically; " +
				"other models get a manual toggle in the chat UI."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.ragSettings.enabled)
					.onChange(async (value) => {
						this.plugin.settings.ragSettings.enabled = value;
						await this.plugin.saveSettings();
						this.plugin.initVaultIndexer();
						this.renderTab("vault-search");
					});
			});

		if (!this.plugin.settings.ragSettings.enabled) return;

		// Embedding configuration
		const embeddingItems = this.addSettingGroup(el, "Embedding");

		new Setting(embeddingItems)
			.setName("Embedding provider")
			.setDesc("Which provider to use for generating embeddings. Uses the API key you've already configured.")
			.addDropdown((dropdown: DropdownComponent) => {
				dropdown.addOption("openai", "OpenAI");
				dropdown.addOption("gemini", "Gemini");
				dropdown.addOption("ollama", "Ollama (local)");
				dropdown.addOption("lmStudio", "LM Studio (local)");
				dropdown.setValue(this.plugin.settings.ragSettings.embeddingProvider);
				dropdown.onChange(async (value) => {
					const provider = value as EmbeddingProvider;
					this.plugin.settings.ragSettings.embeddingProvider = provider;
					this.plugin.settings.ragSettings.embeddingModel = DEFAULT_EMBEDDING_MODELS[provider];
					await this.plugin.saveSettings();
					this.plugin.initVaultIndexer();
					// Re-render to update the model field placeholder
					this.renderTab("vault-search");
				});
			});

		new Setting(embeddingItems)
			.setName("Embedding model")
			.setDesc(
				`Model used to generate embeddings. Default: ${DEFAULT_EMBEDDING_MODELS[this.plugin.settings.ragSettings.embeddingProvider]}`
			)
			.addText((text) => {
				text.setPlaceholder(DEFAULT_EMBEDDING_MODELS[this.plugin.settings.ragSettings.embeddingProvider]);
				text.setValue(this.plugin.settings.ragSettings.embeddingModel);
				text.onChange(async (value) => {
					this.plugin.settings.ragSettings.embeddingModel = value.trim() ||
						DEFAULT_EMBEDDING_MODELS[this.plugin.settings.ragSettings.embeddingProvider];
					await this.plugin.saveSettings();
					this.plugin.initVaultIndexer();
				});
			});

		new Setting(embeddingItems)
			.setName("Results per query")
			.setDesc("How many note chunks to retrieve and inject as context (1–10).")
			.addSlider((slider) => {
				slider
					.setLimits(1, 10, 1)
					.setValue(this.plugin.settings.ragSettings.topK)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.ragSettings.topK = value;
						await this.plugin.saveSettings();
					});
			});

		// Indexing
		const indexItems = this.addSettingGroup(el, "Indexing");

		new Setting(indexItems)
			.setName("Excluded folders")
			.setDesc("Comma-separated vault-root folder paths to skip (e.g. Templates, Archive).")
			.addText((text) => {
				text.setPlaceholder("Templates, Archive");
				text.setValue(this.plugin.settings.ragSettings.excludedFolders.join(", "));
				text.onChange(async (value) => {
					this.plugin.settings.ragSettings.excludedFolders = value
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean);
					await this.plugin.saveSettings();
				});
			});

		// Status display
		const rag = this.plugin.settings.ragSettings;
		const lastIndexedText = rag.lastIndexed
			? `Last indexed: ${new Date(rag.lastIndexed).toLocaleString()} · ${rag.indexedFileCount} file(s)`
			: "Not yet indexed.";

		let indexButton: ButtonComponent;
		const indexSetting = new Setting(indexItems)
			.setName("Index vault")
			.setDesc(lastIndexedText)
			.addButton((button) => {
				indexButton = button;
				button.setButtonText("Index now");
				button.setCta();
				button.onClick(async () => {
					if (!this.plugin.vaultIndexer) {
						new Notice("Vault search is not configured. Check your embedding settings.");
						return;
					}
					button.setButtonText("Indexing…");
					button.setDisabled(true);
					indexSetting.setDesc("Indexing your vault…");
					try {
						const { indexed, skipped } = await this.plugin.vaultIndexer.indexVault(
							this.plugin.settings.ragSettings.excludedFolders,
							({ indexed: done, total }) => {
								indexSetting.setDesc(`Indexing… ${done}/${total} files`);
							}
						);
						this.plugin.settings.ragSettings.lastIndexed = Date.now();
						this.plugin.settings.ragSettings.indexedFileCount =
							this.plugin.vaultIndexer.indexedFileCount;
						await this.plugin.saveSettings();
						new Notice(`✓ Vault indexed — ${indexed} updated, ${skipped} unchanged.`);
						this.renderTab("vault-search");
					} catch (e: any) {
						if (e instanceof OllamaModelNotFoundError) {
							new Notice(
								`Ollama model "${e.model}" isn't pulled yet.\n\nRun this in your terminal:\n  ollama pull ${e.model}`,
								10000
							);
							indexSetting.setDesc(
								`Model not found. Run: ollama pull ${e.model}`
							);
						} else {
							new Notice(`Indexing failed: ${e?.message ?? String(e)}`);
							indexSetting.setDesc(lastIndexedText);
						}
						button.setButtonText("Index now");
						button.setDisabled(false);
					}
				});
			});
	}

	private renderSkills() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Skills");

		const skillsFolder = this.plugin.skillsFolder;

		// Read-only info: show where skills are expected, linking to root folder setting
		el.createDiv({
			cls: "setting-item-description",
			text: `Skills are loaded from "${skillsFolder}". To change the root, update the Root vault folder in General settings.`,
		});

		// Show the skills discovered in the current folder
		const skills = this.plugin.skillRegistry?.getSkills() ?? [];
		if (skills.length === 0) {
			el.createDiv({
				cls: "setting-item-description",
				text: `No skills found in "${skillsFolder}". Create a sub-folder with a SKILL.md file to add one (e.g. "${skillsFolder}/my-skill/SKILL.md").`,
			});
			return;
		}

		el.createEl("p", {
			text: `${skills.length} skill${skills.length === 1 ? "" : "s"} discovered:`,
			cls: "setting-item-description",
		});

		for (const skill of skills) {
			new Setting(el)
				.setName(skill.name)
				.setDesc(
					[
						skill.description,
						`Invoke with /${skill.id}`,
						skill.allowedTools.length > 0
							? `Tools: ${skill.allowedTools.join(", ")}`
							: "All tools allowed",
					]
						.filter(Boolean)
						.join(" · ")
				)
				.addToggle((toggle) => {
					toggle.setValue(
						!!(this.plugin.settings.skillsSettings?.enabledSkills?.[skill.id])
					);
					toggle.onChange(async (value) => {
						if (!this.plugin.settings.skillsSettings) return;
						this.plugin.settings.skillsSettings.enabledSkills[skill.id] = value;
						await this.plugin.saveSettings();
					});
				});
		}
	}

	private renderMemory() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Memory");

		const toggleItems = this.addSettingGroup(el);

		new Setting(toggleItems)
			.setName("Enable memory")
			.setDesc(
				"Remember facts, preferences, and context across conversations. " +
				"Requires Vault Search (RAG) to be enabled for recall."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.memorySettings?.enabled ?? false)
					.onChange(async (value) => {
						if (!this.plugin.settings.memorySettings) {
							this.plugin.settings.memorySettings = {
								enabled: false,
								extractionTrigger: "manual",
								recallTopK: 5,
								recallAlways: false,
							};
						}
						this.plugin.settings.memorySettings.enabled = value;
						await this.plugin.saveSettings();
						this.plugin.initMemoryService();
						this.renderTab("memory");
					});
			});

		const mem = this.plugin.settings.memorySettings;
		if (!mem?.enabled) return;

		if (!this.plugin.settings.ragSettings?.enabled) {
			el.createDiv({
				cls: "setting-item-description",
				text: "⚠️ Memory recall requires Vault Search to be enabled. Enable it in the Vault Search tab.",
			});
		}

		const extractionItems = this.addSettingGroup(el, "Extraction");

		new Setting(extractionItems)
			.setName("Auto-extract at end of chat")
			.setDesc(
				"When enabled, memories are automatically extracted from the conversation " +
				"when you start a new chat. When disabled, use the download button in the " +
				"chat toolbar to extract manually."
			)
			.addToggle((toggle) => {
				toggle
					.setValue((mem.extractionTrigger ?? "manual") === "end-of-chat")
					.onChange(async (value) => {
						this.plugin.settings.memorySettings.extractionTrigger =
							value ? "end-of-chat" : "manual";
						await this.plugin.saveSettings();
					});
			});

		const recallItems = this.addSettingGroup(el, "Recall");

		new Setting(recallItems)
			.setName("Always recall memories")
			.setDesc(
				"When enabled, memory recall is active by default in every conversation — " +
				"no need to click the brain button each time. " +
				"You can still toggle it off per-conversation in the chat toolbar."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(mem.recallAlways ?? false)
					.onChange(async (value) => {
						this.plugin.settings.memorySettings.recallAlways = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(recallItems)
			.setName("Recalled memories per query")
			.setDesc("How many memories to retrieve and inject as context before each message (1–10).")
			.addSlider((slider) => {
				slider
					.setLimits(1, 10, 1)
					.setValue(mem.recallTopK ?? 5)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.memorySettings.recallTopK = value;
						await this.plugin.saveSettings();
					});
			});

		const folderItems = this.addSettingGroup(el, "Storage");

		const root = this.plugin.settings.rootVaultFolder || "AI";
		folderItems.createDiv({
			cls: "setting-item-description",
			text:
				`Memories are stored in your vault under:\n` +
				`  ${root}/Memories/           (global — always recalled)\n` +
				`  ${root}/Assistants/<name>/memories/  (recalled when assistant is active)\n` +
				`  ${root}/Projects/<name>/memories/    (recalled when project is active)\n\n` +
				`Files are plain Markdown — you can read, edit, and delete them directly in Obsidian.`,
		});
	}

	private renderProjects() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Projects");

		const projectsFolder = this.plugin.projectsFolder;
		el.createDiv({
			cls: "setting-item-description",
			text: `Projects are loaded from "${projectsFolder}". Each project is a sub-folder containing a PROJECT.md file.`,
		});

		// ── Create new project form ───────────────────────────────────────────
		const createGroup = this.addSettingGroup(el, "New Project");

		let newProjectName = "";
		let newProjectDescription = "";

		new Setting(createGroup)
			.setName("Project name")
			.setDesc("Used as the display name and folder slug (spaces become hyphens).")
			.addText((text) => {
				text.setPlaceholder("e.g. My Research Project");
				text.onChange((v) => { newProjectName = v; });
			});

		new Setting(createGroup)
			.setName("Description")
			.setDesc("One-line summary shown in the project switcher.")
			.addText((text) => {
				text.setPlaceholder("e.g. Notes and analysis for my research");
				text.onChange((v) => { newProjectDescription = v; });
			});

		new Setting(createGroup)
			.addButton((btn) => {
				btn.setButtonText("Create project")
					.setCta()
					.onClick(async () => {
						const name = newProjectName.trim();
						if (!name) {
							new Notice("Please enter a project name.");
							return;
						}
						// Slugify the name for the folder
						const id = name
							.toLowerCase()
							.replace(/[^\w\s-]/g, "")
							.replace(/\s+/g, "-")
							.replace(/-+/g, "-")
							.replace(/^-|-$/g, "")
							.slice(0, 60) || "project";

						const filePath = await this.plugin.projectManager.createProject(
							id,
							name,
							newProjectDescription.trim()
						);
						if (filePath) {
							new Notice(`✓ Project "${name}" created.`);
							// Open the PROJECT.md in the vault for editing
							const file = this.plugin.app.vault.getFileByPath(filePath);
							if (file) {
								const leaf = this.plugin.app.workspace.getLeaf(false);
								await leaf.openFile(file);
							}
							this.renderTab("projects");
						} else {
							new Notice("Failed to create project.");
						}
					});
			});

		// ── Existing projects ─────────────────────────────────────────────────
		const projects = this.plugin.projectManager?.getProjects() ?? [];
		if (projects.length === 0) {
			el.createDiv({
				cls: "setting-item-description",
				text: "No projects yet. Create one above.",
			});
			return;
		}

		const listGroup = this.addSettingGroup(el, `${projects.length} Project${projects.length === 1 ? "" : "s"}`);
		const activeId = this.plugin.settings.projectSettings?.activeProjectId;

		for (const project of projects) {
			const descParts: string[] = [];
			if (project.description) descParts.push(project.description);
			if (project.pinnedNotes.length > 0) {
				descParts.push(`${project.pinnedNotes.length} pinned note${project.pinnedNotes.length === 1 ? "" : "s"}`);
			}
			if (activeId === project.id) descParts.push("● Active");

			const setting = new Setting(listGroup)
				.setName(project.name)
				.setDesc(descParts.join(" · ") || project.id);

			// Edit: open PROJECT.md in vault
			setting.addButton((btn) => {
				btn.setIcon("pencil")
					.setTooltip("Edit PROJECT.md")
					.onClick(async () => {
						const file = this.plugin.app.vault.getFileByPath(project.filePath);
						if (file) {
							const leaf = this.plugin.app.workspace.getLeaf(false);
							await leaf.openFile(file);
						} else {
							new Notice("PROJECT.md not found in vault.");
						}
					});
			});

			// Activate / deactivate
			setting.addButton((btn) => {
				const isActive = activeId === project.id;
				btn.setButtonText(isActive ? "Deactivate" : "Activate")
					.setTooltip(isActive ? "Clear active project" : "Set as active project")
					.onClick(async () => {
						this.plugin.settings.projectSettings = {
							...this.plugin.settings.projectSettings,
							activeProjectId: isActive ? null : project.id,
						};
						await this.plugin.saveSettings();
						this.renderTab("projects");
					});
			});

			// Delete
			setting.addButton((btn) => {
				btn.setIcon("trash")
					.setTooltip("Delete project")
					.setWarning()
					.onClick(async () => {
						// If deleting the active project, clear active
						if (this.plugin.settings.projectSettings?.activeProjectId === project.id) {
							this.plugin.settings.projectSettings.activeProjectId = null;
							await this.plugin.saveSettings();
						}
						await this.plugin.projectManager.deleteProject(project.id);
						new Notice(`Project "${project.name}" deleted.`);
						this.renderTab("projects");
					});
			});
		}
	}

	private renderAssistants() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Assistants");

		const assistantsFolder = this.plugin.assistantsFolder;
		el.createDiv({
			cls: "setting-item-description",
			text: `Assistants are loaded from "${assistantsFolder}". Each assistant is a sub-folder containing an ASSISTANT.md file.`,
		});

		// ── Create new assistant form ──────────────────────────────────────────
		const createGroup = this.addSettingGroup(el, "New Assistant");

		let newAssistantName = "";
		let newAssistantDescription = "";

		new Setting(createGroup)
			.setName("Name")
			.setDesc("Display name and folder slug (spaces become hyphens).")
			.addText((text) => {
				text.setPlaceholder("e.g. Research Helper");
				text.onChange((v) => { newAssistantName = v; });
			});

		new Setting(createGroup)
			.setName("Description")
			.setDesc("One-line summary of this assistant's purpose.")
			.addText((text) => {
				text.setPlaceholder("e.g. Helps me synthesize research notes");
				text.onChange((v) => { newAssistantDescription = v; });
			});

		new Setting(createGroup)
			.addButton((btn) => {
				btn.setButtonText("Create assistant")
					.setCta()
					.onClick(async () => {
						const name = newAssistantName.trim();
						if (!name) {
							new Notice("Please enter an assistant name.");
							return;
						}
						// Slugify the name for the folder
						const id = name
							.toLowerCase()
							.replace(/[^\w\s-]/g, "")
							.replace(/\s+/g, "-")
							.replace(/-+/g, "-")
							.replace(/^-|-$/g, "")
							.slice(0, 60) || "assistant";

						const filePath = await this.plugin.assistantManager.createAssistant(
							id,
							name,
							newAssistantDescription.trim()
						);
						if (filePath) {
							new Notice(`✓ Assistant "${name}" created.`);
							// Open the ASSISTANT.md in the vault for editing
							const file = this.plugin.app.vault.getFileByPath(filePath);
							if (file) {
								const leaf = this.plugin.app.workspace.getLeaf(false);
								await leaf.openFile(file);
							}
							this.renderTab("assistants");
						} else {
							new Notice("Failed to create assistant.");
						}
					});
			});

		// ── Existing assistants ────────────────────────────────────────────────
		const assistants = this.plugin.assistantManager?.getAssistants() ?? [];
		if (assistants.length === 0) {
			el.createDiv({
				cls: "setting-item-description",
				text: "No assistants yet. Create one above.",
			});
			return;
		}

		const listGroup = this.addSettingGroup(
			el,
			`${assistants.length} Assistant${assistants.length === 1 ? "" : "s"}`
		);
		const activeId = this.plugin.settings.assistantSettings?.activeAssistantId;

		for (const assistant of assistants) {
			const descParts: string[] = [];
			if (assistant.description) descParts.push(assistant.description);
			if (assistant.enabledSkills.length > 0) {
				descParts.push(`${assistant.enabledSkills.length} skill${assistant.enabledSkills.length === 1 ? "" : "s"}`);
			}
			if (assistant.allowedTools.length > 0) {
				descParts.push(`${assistant.allowedTools.length} tool${assistant.allowedTools.length === 1 ? "" : "s"}`);
			}
			if (activeId === assistant.id) descParts.push("● Active");

			const setting = new Setting(listGroup)
				.setName(assistant.name)
				.setDesc(descParts.join(" · ") || assistant.id);

			// Edit: open ASSISTANT.md in vault
			setting.addButton((btn) => {
				btn.setIcon("pencil")
					.setTooltip("Edit ASSISTANT.md")
					.onClick(async () => {
						const file = this.plugin.app.vault.getFileByPath(assistant.filePath);
						if (file) {
							const leaf = this.plugin.app.workspace.getLeaf(false);
							await leaf.openFile(file);
						} else {
							new Notice("ASSISTANT.md not found in vault.");
						}
					});
			});

			// Activate / deactivate
			setting.addButton((btn) => {
				const isActive = activeId === assistant.id;
				btn.setButtonText(isActive ? "Deactivate" : "Activate")
					.setTooltip(isActive ? "Clear active assistant" : "Set as active assistant")
					.onClick(async () => {
						this.plugin.settings.assistantSettings = {
							...this.plugin.settings.assistantSettings,
							activeAssistantId: isActive ? null : assistant.id,
						};
						await this.plugin.saveSettings();
						this.renderTab("assistants");
					});
			});

			// Delete
			setting.addButton((btn) => {
				btn.setIcon("trash")
					.setTooltip("Delete assistant")
					.setWarning()
					.onClick(async () => {
						// If deleting the active assistant, clear active
						if (this.plugin.settings.assistantSettings?.activeAssistantId === assistant.id) {
							this.plugin.settings.assistantSettings.activeAssistantId = null;
							await this.plugin.saveSettings();
						}
						await this.plugin.assistantManager.deleteAssistant(assistant.id);
						new Notice(`Assistant "${assistant.name}" deleted.`);
						this.renderTab("assistants");
					});
			});
		}
	}

	// ── Obsidian Agent ────────────────────────────────────────────────────────

	private renderObsidianAgent() {
		const el = this.mainContentEl;
		this.addTabHeader(el, "Obsidian Agent");

		const s = this.plugin.settings.obsidianAgentSettings ?? {
			enabled: false,
			enableWebSearch: false,
			availableSkills: {},
			availableAssistants: {},
			vaultGuidance: "",
		};

		// ── Enable / Disable ─────────────────────────────────────────────────
		const enableGroup = this.addSettingGroup(el);
		new Setting(enableGroup)
			.setName("Enable Obsidian Agent")
			.setDesc(
				'When enabled, the FAB, status bar button, and the "Open Obsidian Agent" ' +
				"command all open the agent — a vault-aware AI that can read/write notes, " +
				"run skills, and delegate to specialised assistants."
			)
			.addToggle((toggle) => {
				toggle.setValue(s.enabled).onChange(async (value) => {
					this.plugin.settings.obsidianAgentSettings.enabled = value;
					await this.plugin.saveSettings();
					// Regenerate FAB/StatusBar so the agent flag is picked up.
					if (this.plugin.settings.showFAB) this.plugin.fab.regenerateFAB();
					this.renderTab("obsidian-agent");
				});
			});

		if (!s.enabled) return; // Only show further settings when enabled

		// ── Default Model ────────────────────────────────────────────────────
		const modelGroup = this.addSettingGroup(el, "Model");
		const modelSetting = new Setting(modelGroup)
			.setName("Default model")
			.setDesc(
				"The model used when Obsidian Agent is active. " +
				"Leave on 'Use current model' to keep whatever model is selected in the chat toolbar."
			);

		const { openAIAPIKey, claudeAPIKey, geminiAPIKey, mistralAPIKey } = this.plugin.settings;
		modelSetting.addDropdown((dropdown) => {
			dropdown.addOption("", "Use current model");

			// Mirror the same filtering logic used in the chat toolbar dropdown.
			for (const displayName of Object.keys(models)) {
				const m = models[displayName];
				if (m.type === ollama || m.type === lmStudio) {
					dropdown.addOption(m.model, displayName);
					continue;
				}
				if (m.type === GPT4All) continue; // skip GPT4All — path check not available here
				if (m.type === "openAI"    && !openAIAPIKey)  continue;
				if ((m.type === "claude" || m.type === "claudeCode") && !claudeAPIKey) continue;
				if (m.type === "gemini"    && !geminiAPIKey)  continue;
				if (m.type === "mistral"   && !mistralAPIKey) continue;
				dropdown.addOption(m.model, displayName);
			}

			dropdown.setValue(s.defaultModel ?? "");
			dropdown.onChange(async (value) => {
				this.plugin.settings.obsidianAgentSettings.defaultModel = value || undefined;
				await this.plugin.saveSettings();
			});
		});

		// ── Available Skills ─────────────────────────────────────────────────
		const skills = this.plugin.skillRegistry?.getSkills() ?? [];
		if (skills.length > 0) {
			const skillGroup = this.addSettingGroup(el, "Available Skills");
			const skillDesc = el.createEl("p", {
				cls: "setting-item-description",
				text: "Choose which skills the Obsidian Agent can invoke. Deselecting a skill hides it from the agent's context entirely.",
			});
			skillGroup.prepend(skillDesc);

			for (const skill of skills) {
				const isAvailable = s.availableSkills[skill.id] !== false;
				new Setting(skillGroup)
					.setName(skill.name)
					.setDesc(skill.description || `/${skill.id}`)
					.addToggle((toggle) => {
						toggle.setValue(isAvailable).onChange(async (value) => {
							this.plugin.settings.obsidianAgentSettings.availableSkills[skill.id] = value;
							await this.plugin.saveSettings();
						});
					});
			}
		} else {
			el.createEl("p", {
				cls: "setting-item-description",
				text: "No skills found. Create skill folders in your AI/Skills/ directory.",
			});
		}

		// ── Available Assistants ─────────────────────────────────────────────
		const assistants = this.plugin.assistantManager?.getAssistants() ?? [];
		if (assistants.length > 0) {
			const assistantGroup = this.addSettingGroup(el, "Available Assistants");
			const assistantDesc = el.createEl("p", {
				cls: "setting-item-description",
				text: "Choose which assistants the agent can route sub-tasks to via the invoke_assistant tool.",
			});
			assistantGroup.prepend(assistantDesc);

			for (const assistant of assistants) {
				const isAvailable = s.availableAssistants[assistant.id] !== false;
				new Setting(assistantGroup)
					.setName(assistant.name)
					.setDesc(assistant.description || assistant.id)
					.addToggle((toggle) => {
						toggle.setValue(isAvailable).onChange(async (value) => {
							this.plugin.settings.obsidianAgentSettings.availableAssistants[assistant.id] = value;
							await this.plugin.saveSettings();
						});
					});
			}
		} else {
			el.createEl("p", {
				cls: "setting-item-description",
				text: "No assistants found. Create assistant folders in your AI/Assistants/ directory.",
			});
		}

		// ── Vault Guidance ───────────────────────────────────────────────────
		const guidanceGroup = this.addSettingGroup(el, "Vault Guidance");
		new Setting(guidanceGroup)
			.setName("Custom instructions")
			.setDesc(
				"Free-text instructions appended after the agent's auto-generated base prompt. " +
				"Use this to describe your vault structure, preferred workflows, or routing rules. " +
				'Example: "When asked to do research, use the Research Assistant. Always save findings in Projects/Research/."'
			)
			.addTextArea((textarea) => {
				textarea
					.setPlaceholder(
						"Describe your vault, preferred workflows, or routing rules…"
					)
					.setValue(s.vaultGuidance ?? "")
					.onChange(async (value) => {
						this.plugin.settings.obsidianAgentSettings.vaultGuidance = value;
						await this.plugin.saveSettings();
					});
				textarea.inputEl.rows = 6;
				textarea.inputEl.addClass("llm-agent-guidance-textarea");
			});
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	private addTabHeader(el: HTMLElement, title: string) {
		const header = el.createDiv("llm-dedicated-settings-tab-header");
		header.createEl("h2", {
			text: title,
			cls: "llm-dedicated-settings-tab-title",
		});
	}

	/**
	 * Creates a .setting-group with an optional heading that matches Obsidian's
	 * native pattern: div.setting-group > div.setting-item.setting-item-heading
	 *                                   > div.setting-items > div.setting-item …
	 * Returns the .setting-items element for appending Setting instances.
	 */
	private addSettingGroup(parent: HTMLElement, heading?: string): HTMLElement {
		const group = parent.createDiv("setting-group");
		if (heading) {
			new Setting(group).setName(heading).setHeading();
		}
		return group.createDiv("setting-items");
	}

	private renderWorkspaceList(containerEl: HTMLElement) {
		containerEl.empty();
		const workspaces = this.plugin.settings.linearWorkspaces;

		workspaces.forEach((ws, index) => {
			const row = new Setting(containerEl)
				.addText((text) => {
					text.setPlaceholder("Workspace name");
					text.setValue(ws.name);
					text.onChange((value) => {
						this.plugin.settings.linearWorkspaces[index].name = value;
						this.plugin.saveSettings();
					});
				})
				.addText((text) => {
					text.setPlaceholder("API key");
					text.inputEl.type = "password";
					text.setValue(ws.apiKey);
					text.onChange((value) => {
						this.plugin.settings.linearWorkspaces[index].apiKey = value;
						this.plugin.saveSettings();
					});
				})
				.addButton((button) => {
					button.setIcon("trash");
					button.setTooltip("Remove workspace");
					button.onClick(() => {
						this.plugin.settings.linearWorkspaces.splice(index, 1);
						this.plugin.saveSettings();
						this.renderWorkspaceList(containerEl);
					});
				});
			row.setName(ws.name || `Workspace ${index + 1}`);
		});
	}
}
