import LLMPlugin from "main";
import {
	App,
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	Platform,
	requestUrl,
	Setting,
	setIcon,
	TFile,
} from "obsidian";
import { FeatureSettings } from "Types/types";
import { changeDefaultModel, fetchOllamaModels, fetchOllamaContextWindows, fetchLMStudioModels, getGpt4AllPath } from "utils/utils";
import { getErrorMessage } from "utils/errorUtils";
import { buildOllamaModels, buildLMStudioModels, modelNames, models } from "utils/models";
import { GPT4All, ollama, lmStudio } from "utils/constants";
import { FAB } from "Plugin/FAB/FAB";
import { ChatModal2 } from "Plugin/Modal/ChatModal2";
import { EmbeddingService, EmbeddingProvider, DEFAULT_EMBEDDING_MODELS } from "RAG/EmbeddingService";
import { ALL_TOOL_DEFINITIONS } from "services/ObsidianToolRegistry";
import { ensureSDKInstalled, isSDKInstalled } from "services/ClaudeAgentSDKInstaller";

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
	/** When set, this nav item is hidden unless the named feature is enabled. */
	featureGate?: keyof FeatureSettings;
}

export class LLMSettingsModal extends Modal {
	plugin: LLMPlugin;
	fab: FAB;
	private activeTab = "general";
	private mainContentEl!: HTMLElement;

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
				{ id: "obsidian-agent", label: "Obsidian Agent",  icon: "stone",          featureGate: "obsidianAgent" },
				{ id: "interface",      label: "Interface",       icon: "layout-dashboard" },
				{ id: "chat",           label: "Chat",            icon: "message-square" },
				{ id: "tools",          label: "Tools",           icon: "wrench" },
				{ id: "skills",         label: "Skills",          icon: "scroll-text" },
				{ id: "connectors",     label: "Connectors",      icon: "blocks" },
				{ id: "memory",         label: "Memory",          icon: "brain",           featureGate: "memory" },
				{ id: "embeddings",     label: "Embeddings",      icon: "database",        featureGate: "vaultSearch" },
				{ id: "projects",       label: "Projects",        icon: "folder-open",     featureGate: "projects" },
				{ id: "assistants",     label: "Assistants",      icon: "bot",             featureGate: "assistants" },
				{ id: "transcription",  label: "Transcription",   icon: "mic",             featureGate: "transcription" },
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
				{ id: "gpt4all",      label: "GPT4All",      icon: "hard-drive" },
			],
		},
	];

	private coreModalEl: HTMLElement | null = null;
	private resizeHandler: (() => void) | null = null;
	private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
	private sidebarEl: HTMLElement | null = null;

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
			activeDocument.querySelector<HTMLElement>(".modal-container.mod-settings .modal") ??
			Array.from(activeDocument.querySelectorAll<HTMLElement>(".modal-container .modal"))
				.find((el) => el !== modalEl && !el.contains(modalEl)) ??
			null;

		// Hide our scrim so we look like part of the core settings panel.
		const modalBg = modalEl.closest(".modal-container")
			?.querySelector<HTMLElement>(".modal-bg");
		if (modalBg) modalBg.addClass("llm-hidden");

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
		window.setTimeout(() => {
			activeDocument.addEventListener("mousedown", this.outsideClickHandler!);
		}, 0);

		// mod-sidebar-layout tells Obsidian's CSS to apply the two-column layout.
		modalEl.addClass("mod-sidebar-layout");

		this.contentEl.empty();
		// vertical-tabs-container is the flex wrapper Obsidian uses in its own settings.
		this.contentEl.addClass("vertical-tabs-container");

		// Sidebar — uses Obsidian's own vertical tab header classes.
		this.sidebarEl = this.contentEl.createDiv("vertical-tab-header");
		this.buildSidebar(this.sidebarEl);

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
			activeDocument.removeEventListener("mousedown", this.outsideClickHandler);
			this.outsideClickHandler = null;
		}
		this.contentEl.empty();
	}

	private buildSidebar(sidebar: HTMLElement) {
		const featureSettings = this.plugin.settings.featureSettings ?? {};
		for (const section of this.navSections) {
			// Filter items by feature gate before rendering the section.
			const visibleItems = section.items.filter(
				(item) => !item.featureGate || featureSettings[item.featureGate]
			);
			if (visibleItems.length === 0) continue;

			const groupEl = sidebar.createDiv("vertical-tab-header-group");
			groupEl.createDiv({
				cls:  "vertical-tab-header-group-title",
				text: section.label,
			});

			// vertical-tab-header-group-items is the core container for items.
			const itemsEl = groupEl.createDiv("vertical-tab-header-group-items");

			for (const item of visibleItems) {
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

	/** Rebuilds just the sidebar in-place (called after feature toggles change). */
	private rebuildSidebar() {
		if (!this.sidebarEl) return;
		this.sidebarEl.empty();
		this.buildSidebar(this.sidebarEl);
	}

	private renderTab(tabId: string) {
		// Stop any background poll (e.g. sidecar startup check) before wiping the DOM
		this._sidecarPollCleanup?.();
		this._sidecarPollCleanup = null;
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
			case "gpt4all":       this.renderGPT4All();     break;
			case "chat":          this.renderChat();         break;
			case "tools":         this.renderTools();        break;
			case "embeddings":    this.renderEmbeddings();   break;
			case "skills":        this.renderSkills();        break;
			case "connectors":    this.renderConnectors();    break;
			case "memory":        this.renderMemory();        break;
			case "projects":      this.renderProjects();      break;
			case "assistants":      this.renderAssistants();      break;
			case "obsidian-agent":  this.renderObsidianAgent();   break;
			case "transcription":   this.renderTranscription();   break;
		}
	}

	// ── Tab renderers ──────────────────────────────────────────────────────────

	private renderGeneral() {
		const el = this.mainContentEl;
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
				const modelsGroup = activeDocument.createElement("optgroup");
				modelsGroup.label = "Models";
				for (const model of Object.keys(allModels)) {
					const type = allModels[model].type;
					if (type === ollama || type === lmStudio) {
						const opt = activeDocument.createElement("option");
						opt.value = allModels[model].model;
						opt.text = model;
						modelsGroup.appendChild(opt);
						continue;
					}
					if (type === GPT4All) {
						const fullPath = `${getGpt4AllPath(this.plugin)}/${allModels[model].model}`;
						if (this.plugin.fileSystem.existsSync(fullPath)) {
							const opt = activeDocument.createElement("option");
							opt.value = allModels[model].model;
							opt.text = model;
							modelsGroup.appendChild(opt);
						}
						continue;
					}
					const opt = activeDocument.createElement("option");
					opt.value = allModels[model].model;
					opt.text = model;
					modelsGroup.appendChild(opt);
				}
				dropdown.selectEl.appendChild(modelsGroup);

				// ── Assistants optgroup (includes built-in Obsidian Agent) ───────
				const assistants = this.plugin.assistantManager?.getAssistants() ?? [];
				const agentEnabled = this.plugin.settings.obsidianAgentSettings?.enabled;
				if (agentEnabled || assistants.length > 0) {
					const assistantsGroup = activeDocument.createElement("optgroup");
					assistantsGroup.label = "Assistants";
					// Obsidian Agent pinned first, only when the feature is enabled
					if (agentEnabled) {
						const agentOpt = activeDocument.createElement("option");
						agentOpt.value = "agent:obsidian";
						agentOpt.text = "Obsidian Agent";
						assistantsGroup.appendChild(agentOpt);
					}
					for (const assistant of assistants) {
						const opt = activeDocument.createElement("option");
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
						void this.plugin.saveSettings();
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
					void this.plugin.saveSettings();
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

		// ── Features ──────────────────────────────────────────────────────────
		const featureItems = this.addSettingGroup(el, "Features");

		type FeatureDef = {
			key: keyof import("Types/types").FeatureSettings;
			name: string;
			desc: string;
			onEnable?: () => Promise<void> | void;
			onDisable?: () => Promise<void> | void;
		};

		const featureDefs: FeatureDef[] = [
			{
				key: "obsidianAgent",
				name: "Obsidian Agent",
				desc: "An always-on vault agent that can read and write notes, invoke skills, and route to custom assistants. Accessible from the FAB and status bar.",
				onEnable: async () => {
					this.plugin.settings.obsidianAgentSettings.enabled = true;
					await this.plugin.saveSettings();
					this.plugin.fab.regenerateFAB();
				},
				onDisable: async () => {
					this.plugin.settings.obsidianAgentSettings.enabled = false;
					// If currently showing Obsidian Agent, leave that setting intact
					// but hide the nav — navigate back to general so the tab isn't orphaned.
					if (this.activeTab === "obsidian-agent") {
						this.activeTab = "general";
						this.renderTab("general");
					}
					await this.plugin.saveSettings();
					this.plugin.fab.regenerateFAB();
				},
			},
			{
				key: "transcription",
				name: "Transcription",
				desc: "Voice input via microphone and audio-file transcription using OpenAI Whisper or a local Python sidecar.",
				onEnable: async () => {
					this.plugin.settings.whisperSettings.enabled = true;
					await this.plugin.saveSettings();
					this.plugin.initWhisperService();
					this.plugin.refreshAllMicButtons();
				},
				onDisable: async () => {
					this.plugin.settings.whisperSettings.enabled = false;
					if (this.activeTab === "transcription") {
						this.activeTab = "general";
						this.renderTab("general");
					}
					await this.plugin.saveSettings();
					this.plugin.initWhisperService();
					this.plugin.refreshAllMicButtons();
				},
			},
			{
				key: "projects",
				name: "Projects",
				desc: "Named workspaces that scope every conversation with custom system instructions, pinned notes, and project-level memory.",
				onDisable: async () => {
					if (this.activeTab === "projects") {
						this.activeTab = "general";
						this.renderTab("general");
					}
					await this.plugin.saveSettings();
				},
			},
			{
				key: "assistants",
				name: "Assistants",
				desc: "Vault-native AI personas defined as ASSISTANT.md files — each with its own system prompt, preferred model, and allowed tools.",
				onDisable: async () => {
					if (this.activeTab === "assistants") {
						this.activeTab = "general";
						this.renderTab("general");
					}
					await this.plugin.saveSettings();
				},
			},
			{
				key: "memory",
				name: "Memory",
				desc: "Automatically extract and recall facts, preferences, and context across conversations. Requires Embeddings to be enabled.",
				onEnable: async () => {
					this.plugin.settings.memorySettings.enabled = true;
					await this.plugin.saveSettings();
					this.plugin.initMemoryService();
					if (!this.plugin.settings.ragSettings?.enabled) {
						new Notice(
							"Memory requires Embeddings to work. Enable Embeddings in the Features section below.",
							8000
						);
					}
				},
				onDisable: async () => {
					this.plugin.settings.memorySettings.enabled = false;
					if (this.activeTab === "memory") {
						this.activeTab = "general";
						this.renderTab("general");
					}
					await this.plugin.saveSettings();
					this.plugin.initMemoryService();
				},
			},
			{
				key: "vaultSearch",
				name: "Embeddings",
				desc: "Index your vault with embeddings so tool-capable models can semantically search your notes, and for use by the Memory feature.",
				onEnable: async () => {
					this.plugin.settings.ragSettings.enabled = true;
					await this.plugin.saveSettings();
					this.plugin.initVaultIndexer();
				},
				onDisable: async () => {
					this.plugin.settings.ragSettings.enabled = false;
					if (this.activeTab === "embeddings") {
						this.activeTab = "general";
						this.renderTab("general");
					}
					await this.plugin.saveSettings();
					this.plugin.initVaultIndexer();
				},
			},
		];

		for (const def of featureDefs) {
			new Setting(featureItems)
				.setName(def.name)
				.setDesc(def.desc)
				.addToggle((toggle) => {
					const fs = this.plugin.settings.featureSettings ?? {} as import("Types/types").FeatureSettings;
					toggle
						.setValue(!!fs[def.key])
						.onChange(async (value) => {
							if (!this.plugin.settings.featureSettings) {
								this.plugin.settings.featureSettings = {
									obsidianAgent: false,
									transcription: false,
									projects: false,
									assistants: false,
									memory: false,
									vaultSearch: false,
								};
							}
							this.plugin.settings.featureSettings[def.key] = value;
							if (value) {
								await def.onEnable?.();
							} else {
								await def.onDisable?.();
							}
							await this.plugin.saveSettings();
							this.rebuildSidebar();
						});
				});
		}

		// ── Guidance (AGENTS.md) — declared early so the rootVaultFolder onChange
		// closure can re-render it when the path is auto-updated.
		// eslint-disable-next-line prefer-const
		let agentsGroup: HTMLElement;

		const renderAgentsPicker = () => {
			agentsGroup.empty();
			this.renderGuidanceFilePicker(
				agentsGroup,
				"Instructions file",
				"Vault-relative path to your general instructions note (e.g. AI/AGENTS.md). Its contents are injected into every conversation — all models, assistants, and the Obsidian Agent. Use it to describe how you work, your preferred response style, or vault conventions that should always apply.",
				"AI/AGENTS.md",
				`# General Instructions\n\nThis note is injected into every conversation in this vault.\n\n## About This Vault\n\n<!-- Describe how your vault is organised, what it's for, naming conventions, etc. -->\n\n## Preferred Behaviors\n\n<!-- Describe your preferred response style, tone, format, or workflow. -->\n\n## Conventions\n\n<!-- Note any file templates, frontmatter patterns, or folder rules the AI should follow. -->\n`,
				() => this.plugin.settings.agentsFilePath ?? "",
				async (value) => {
					this.plugin.settings.agentsFilePath = value;
					await this.plugin.saveSettings();
					this.plugin.refreshAllChips?.();
				},
			);
		};

		// Root vault folder
		let prevRoot = (this.plugin.settings.rootVaultFolder ?? "").trim();
		new Setting(items)
			.setName("Root vault folder")
			.setDesc(
				"Vault folder used as the root for all AI feature data. " +
				"For example, entering \"AI\" will store Skills at AI/Skills, Projects at AI/Projects, " +
				"Memories at AI/Memories, and so on. Leave blank to keep your vault unchanged."
			)
			.addText((text) => {
				text.setPlaceholder("e.g. AI");
				text.setValue(this.plugin.settings.rootVaultFolder ?? "");
				text.onChange(async (value) => {
					const newRoot = value.trim();
					this.plugin.settings.rootVaultFolder = newRoot;

					// Auto-update agentsFilePath when it still matches the derived default
					// (i.e. the user hasn't customised it). Re-render the picker so the
					// new path is visible immediately.
					const oldDefault = prevRoot ? `${prevRoot}/AGENTS.md` : "AI/AGENTS.md";
					if (this.plugin.settings.agentsFilePath === oldDefault) {
						this.plugin.settings.agentsFilePath = newRoot
							? `${newRoot}/AGENTS.md`
							: "AI/AGENTS.md";
						renderAgentsPicker();
						this.plugin.refreshAllChips?.();
					}
					prevRoot = newRoot;

					await this.plugin.saveSettings();
					await this.plugin.reinitSkillRegistry();
					await this.plugin.reinitProjectManager();
					await this.plugin.reinitAssistantManager();
				});
			});

		agentsGroup = this.addSettingGroup(el, "Guidance");
		renderAgentsPicker();
	}

	private renderInterface() {
		const el = this.mainContentEl;
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

		new Setting(items)
			.setName("Assistant logo")
			.setDesc("Show the assistant logo icon next to each AI response.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showAssistantLogo)
					.onChange(async (value) => {
						this.plugin.settings.showAssistantLogo = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(items)
			.setName("Obsidian Agent icon")
			.setDesc("Show the Obsidian Agent icon at the bottom of the last message. When enabled, the assistant logo is hidden for agent responses.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.showAgentBrandIcon)
					.onChange(async (value) => {
						this.plugin.settings.showAgentBrandIcon = value;
						await this.plugin.saveSettings();
					});
			});

		// Easter egg — passphrase field always visible; toggle only active when correct
		const alreadyUnlocked = this.plugin.settings.useSpecialAnimation;
		let toggleComponent: import("obsidian").ToggleComponent;
		const eggSetting = new Setting(items)
			.setName("Custom loading animation")
			.setDesc("Replace the default thinking animation with a special one.")
			.addText((text) => {
				text.setPlaceholder("Passphrase")
					.inputEl.addClass("llm-egg-passphrase");
				text.inputEl.type = "password";
				if (alreadyUnlocked) text.setValue("frontier");
				text.onChange((value) => {
					const correct = value.trim() === "frontier";
					toggleComponent.setDisabled(!correct);
					if (!correct && this.plugin.settings.useSpecialAnimation) {
						this.plugin.settings.useSpecialAnimation = false;
						toggleComponent.setValue(false);
						void this.plugin.saveSettings();
					}
				});
			})
			.addToggle((toggle) => {
				toggleComponent = toggle;
				toggle
					.setValue(this.plugin.settings.useSpecialAnimation)
					.setDisabled(!alreadyUnlocked)
					.onChange(async (value) => {
						this.plugin.settings.useSpecialAnimation = value;
						await this.plugin.saveSettings();
					});
			});
		void eggSetting;
	}

	/**
	 * Renders a file-picker row: a path text input + a smart button that says
	 * "Open" when the file exists or "Create" when it doesn't.
	 *
	 * @param container    - The HTMLElement to append the Setting into
	 * @param name         - Setting row label
	 * @param desc         - Setting row description
	 * @param placeholder  - Placeholder path shown when the field is empty
	 * @param template     - Markdown content written when "Create" is pressed
	 * @param getValue     - Returns the current stored path
	 * @param setValue     - Persists a new path value
	 */
	private renderGuidanceFilePicker(
		container: HTMLElement,
		name: string,
		desc: string,
		placeholder: string,
		template: string,
		getValue: () => string,
		setValue: (path: string) => Promise<void>,
	): void {
		let currentPath = getValue();

		const setting = new Setting(container).setName(name).setDesc(desc);

		// ── Path text input ───────────────────────────────────────────────────
		setting.addText((text) => {
			text.setPlaceholder(placeholder)
				.setValue(currentPath)
				.onChange(async (value) => {
					currentPath = value.trim();
					await setValue(currentPath);
				});
			text.inputEl.addClass("llm-guidance-file-input");
		});

		// ── Edit button ───────────────────────────────────────────────────────
		setting.addButton((b) => {
			b.setButtonText("Edit");
			b.onClick(async () => {
				const path = currentPath || placeholder;
				// Persist path if it was still the placeholder default
				if (!currentPath) {
					currentPath = path;
					await setValue(path);
				}
				// Render the editor as an overlay inside the parent modal's own box
				// (modalEl) — avoids triggering the parent modal's close handlers.
				void new GuidanceEditorOverlay(this.plugin, this.modalEl, path, template).open();
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
					(this.plugin.settings[config.key] as string) = value;
					void this.plugin.saveSettings();
					// Refresh empty state live so the setup hint appears/disappears
					// as the user types or clears a key.
					this.plugin.refreshAllEmptyStates();
					// Re-render the agent settings tab so model dropdowns reflect the
					// newly entered (or cleared) API key immediately.
					if (this.activeTab === "obsidian-agent") {
						this.renderTab("obsidian-agent");
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

		// API key
		const apiItems = this.addSettingGroup(el);
		this.renderApiKeyField(apiItems, this.apiKeyConfigs.claude);

		// Test Claude API key button + status
		const apiTestSetting = new Setting(apiItems)
			.setName("Test Claude API key")
			.setDesc("Verify your API key is valid and can reach the Anthropic API.");
		let apiStatusEl: HTMLElement | null = null;
		apiTestSetting.addButton((btn) => {
			btn.setButtonText("Test");
			btn.onClick(async () => {
				if (apiStatusEl) apiStatusEl.remove();
				apiStatusEl = apiTestSetting.descEl.createDiv({ cls: "llm-api-test-status llm-api-test-running", text: "Testing…" });
				btn.setDisabled(true);
				try {
					const key = this.plugin.settings.claudeAPIKey?.trim();
					if (!key) throw new Error("No API key configured.");
					const resp = await requestUrl({
						url: "https://api.anthropic.com/v1/models",
						headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
						throw: false,
					});
					if (resp.status < 400) {
						apiStatusEl.className = "llm-api-test-status llm-api-test-ok";
						apiStatusEl.setText("✓ API key is valid.");
					} else {
						const msg = resp.json?.error?.message ?? resp.text ?? String(resp.status);
						apiStatusEl.className = "llm-api-test-status llm-api-test-fail";
						apiStatusEl.setText(`✗ ${resp.status}: ${msg}`);
					}
				} catch (e) {
					if (apiStatusEl) {
						apiStatusEl.className = "llm-api-test-status llm-api-test-fail";
						apiStatusEl.setText(`✗ ${getErrorMessage(e) || "Unknown error"}`);
					}
				} finally {
					btn.setDisabled(false);
				}
			});
		});

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
					void this.plugin.saveSettings();
				});
			})
			.addButton((btn) => {
				btn.setButtonText("Sync from Keychain").setTooltip("Read token from macOS Keychain (requires Claude Code desktop app to be installed and authenticated)");
				btn.onClick(async () => {
					btn.setDisabled(true);
					btn.setButtonText("Syncing…");
					const token = await this.plugin.readClaudeCodeTokenFromKeychain();
					btn.setDisabled(false);
					btn.setButtonText("Sync from Keychain");
					if (token) {
						this.plugin.settings.claudeCodeOAuthToken = token;
						await this.plugin.saveSettings();
						// Re-render to show updated value in the password field
						this.renderTab("anthropic");
						new Notice("✓ Claude Code token synced from Keychain.");
					} else {
						new Notice("Could not read token from Keychain. Make sure Claude Code is installed and you've run `claude` to authenticate.", 8000);
					}
				});
			});

		// Test OAuth token button + status
		const oauthTestSetting = new Setting(authItems)
			.setName("Test OAuth token")
			.setDesc("Verify your Claude Code OAuth token is valid.");
		let oauthStatusEl: HTMLElement | null = null;
		oauthTestSetting.addButton((btn) => {
			btn.setButtonText("Test");
			btn.onClick(async () => {
				if (oauthStatusEl) oauthStatusEl.remove();
				oauthStatusEl = oauthTestSetting.descEl.createDiv({ cls: "llm-api-test-status llm-api-test-running", text: "Testing…" });
				btn.setDisabled(true);
				try {
					const token = this.plugin.settings.claudeCodeOAuthToken?.trim();
					if (!token) throw new Error("No OAuth token configured.");
					const resp = await requestUrl({
						url: "https://api.anthropic.com/v1/models",
						headers: { "Authorization": `Bearer ${token}`, "anthropic-version": "2023-06-01" },
						throw: false,
					});
					if (resp.status < 400) {
						oauthStatusEl.className = "llm-api-test-status llm-api-test-ok";
						oauthStatusEl.setText("✓ OAuth token is valid.");
					} else {
						const msg = resp.json?.error?.message ?? resp.text ?? String(resp.status);
						oauthStatusEl.className = "llm-api-test-status llm-api-test-fail";
						oauthStatusEl.setText(`✗ ${resp.status}: ${msg}`);
					}
				} catch (e) {
					if (oauthStatusEl) {
						oauthStatusEl.className = "llm-api-test-status llm-api-test-fail";
						oauthStatusEl.setText(`✗ ${getErrorMessage(e) || "Unknown error"}`);
					}
				} finally {
					btn.setDisabled(false);
				}
			});
		});

		// Runtime SDK install — desktop-only: the installer needs Node (fs/npm)
		// and Claude Code itself never runs on mobile.
		if (Platform.isDesktop) {
			const vaultBasePath = (this.plugin.app.vault.adapter as any).getBasePath?.() ?? "";
			// eslint-disable-next-line @typescript-eslint/no-require-imports -- Node builtin; lazily required inside the Platform.isDesktop block
			const pluginDir = require("path").join(vaultBasePath, this.plugin.manifest.dir);
			const sdkAlreadyInstalled = isSDKInstalled(pluginDir);
			const sdkInstallSetting = new Setting(authItems)
				.setName("Runtime SDK")
				.setDesc(sdkAlreadyInstalled
					? "Claude Code runtime SDK is installed."
					: "The Claude Code runtime SDK (~69 MB) must be downloaded before use. Requires npm and an internet connection.");
			let sdkStatusEl: HTMLElement | null = null;
			if (!sdkAlreadyInstalled) {
				sdkInstallSetting.addButton((btn) => {
					btn.setButtonText("Download SDK");
					btn.onClick(async () => {
						if (sdkStatusEl) sdkStatusEl.remove();
						sdkStatusEl = sdkInstallSetting.descEl.createDiv({ cls: "llm-api-test-status llm-api-test-running", text: "Downloading (~69 MB)…" });
						btn.setDisabled(true);
						try {
							await ensureSDKInstalled(pluginDir);
							sdkStatusEl.className = "llm-api-test-status llm-api-test-ok";
							sdkStatusEl.setText("✓ Runtime SDK installed.");
							sdkInstallSetting.setDesc("Claude Code runtime SDK is installed.");
							btn.buttonEl.remove();
						} catch (e) {
							sdkStatusEl.className = "llm-api-test-status llm-api-test-fail";
							sdkStatusEl.setText(`✗ ${getErrorMessage(e) || "Installation failed"}`);
							btn.setDisabled(false);
						}
					});
				});
			}
		} else {
			new Setting(authItems)
				.setName("Runtime SDK")
				.setDesc("Claude Code is only available in Obsidian Desktop.");
		}
	}

	private renderConnectors() {
		const el = this.mainContentEl;

		// Linear workspaces
		const workspaceItems = this.addSettingGroup(el, "Linear");
		const workspaceListEl = workspaceItems.createDiv({ cls: "linear-workspace-list" });
		this.renderWorkspaceList(workspaceListEl);
		const addWorkspaceSetting = new Setting(workspaceItems)
			.setName("Add workspace")
			.addButton((button) => {
				button.setButtonText("+ Add Linear workspace");
				button.onClick(() => {
					this.plugin.settings.linearWorkspaces.push({ name: "", apiKey: "" });
					void this.plugin.saveSettings();
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
		const items = this.addSettingGroup(el);
		this.renderApiKeyField(items, this.apiKeyConfigs.openai);
	}

	private renderGemini() {
		const el = this.mainContentEl;
		const items = this.addSettingGroup(el);
		this.renderApiKeyField(items, this.apiKeyConfigs.gemini);
	}

	private renderMistral() {
		const el = this.mainContentEl;
		const items = this.addSettingGroup(el);
		this.renderApiKeyField(items, this.apiKeyConfigs.mistral);
	}

	private renderOllama() {
		const el = this.mainContentEl;
		const items = this.addSettingGroup(el);

		new Setting(items)
			.setName("Ollama host")
			.setDesc("URL of your Ollama server (default: http://localhost:11434).")
			.addText((text) => {
				text.setPlaceholder("http://localhost:11434");
				text.setValue(this.plugin.settings.ollamaHost);
				text.onChange((value) => {
					this.plugin.settings.ollamaHost = value;
					void this.plugin.saveSettings();
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
						const ctxWindows = await fetchOllamaContextWindows(
							this.plugin.settings.ollamaHost,
							foundModels
						);
						this.plugin.settings.ollamaModels = foundModels;
						this.plugin.settings.ollamaContextWindows = ctxWindows;
						const built = buildOllamaModels(foundModels, ctxWindows);
						Object.assign(models, built.models);
						Object.assign(modelNames, built.names);
						await this.plugin.saveSettings();
						this.plugin.refreshAllEmptyStates();
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
		const items = this.addSettingGroup(el);

		new Setting(items)
			.setName("LM Studio host")
			.setDesc("URL of your LM Studio server (default: http://localhost:1234).")
			.addText((text) => {
				text.setPlaceholder("http://localhost:1234");
				text.setValue(this.plugin.settings.lmStudioHost);
				text.onChange((value) => {
					this.plugin.settings.lmStudioHost = value;
					void this.plugin.saveSettings();
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
						this.plugin.refreshAllEmptyStates();
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

	private renderGPT4All() {
		const el = this.mainContentEl;

		const infoItems = this.addSettingGroup(el);
		const gpt4AllPath = getGpt4AllPath(this.plugin);

		new Setting(infoItems)
			.setName("Local model path")
			.setDesc(
				`GPT4All models are loaded from your local installation. ` +
				`Download models in the GPT4All desktop app, then select them here.`
			)
			.addText((text) => {
				text.setValue(gpt4AllPath);
				text.inputEl.setAttr("readonly", true);
				text.inputEl.addClass("llm-settings-readonly-path");
			});

		// Scan for installed models
		const detectedModels: string[] = [];
		for (const [name, def] of Object.entries(models)) {
			if (def.type !== GPT4All) continue;
			const fullPath = `${gpt4AllPath}/${def.model}`;
			if (this.plugin.fileSystem.existsSync(fullPath)) {
				detectedModels.push(name);
			}
		}

		const modelListEl = infoItems.createEl("p", {
			cls: "setting-item-description llm-settings-ollama-models",
		});
		if (detectedModels.length > 0) {
			modelListEl.setText(`Installed models: ${detectedModels.join(", ")}`);
		} else {
			modelListEl.setText(
				"No GPT4All models found. Open the GPT4All app and download at least one model, then click Refresh."
			);
		}

		new Setting(infoItems)
			.setName("Refresh models")
			.setDesc("Re-scan for GPT4All models installed on this computer.")
			.addButton((button) => {
				button.setButtonText("Refresh");
				button.onClick(() => {
					this.renderTab("gpt4all");
				});
			});

		new Setting(infoItems)
			.setName("API port")
			.setDesc(
				"GPT4All exposes a local API server on port 4891. " +
				"Enable it in GPT4All → Settings → Enable local API server before using this provider."
			)
			.addText((text) => {
				text.setValue("http://localhost:4891");
				text.inputEl.setAttr("readonly", true);
				text.inputEl.addClass("llm-settings-readonly-path");
			});
	}

	private renderChat() {
		const el = this.mainContentEl;

		// File context
		const contextItems = this.addSettingGroup(el);
		new Setting(contextItems)
			.setName("Enable file context")
			.setDesc(
				"Allow models to access vault files. When disabled, models will not have access to any files from your vault."
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

		// Dynamic section (folder + migration) — own group that re-renders on toggle.
		const migrationGroup = el.createDiv("setting-group");
		const migrationEl = migrationGroup.createDiv("setting-items");

		const renderHistorySection = () => {
			migrationEl.empty();
			if (!this.plugin.settings.chatHistoryEnabled) {
				// Legacy mode — show the reset button for old promptHistory entries.
				migrationGroup.removeClass("llm-hidden");
				new Setting(migrationEl)
					.setName("Reset legacy chat history")
					.setDesc("Clears the old in-settings chat history only. Your saved markdown chat files in your vault are not affected.")
					.addButton((button: ButtonComponent) => {
						button.setButtonText("Reset history");
						button.setDestructive();
						button.onClick(() => {
							this.plugin.history.reset();
						});
					});
				return;
			}
			migrationGroup.removeClass("llm-hidden");

			new Setting(migrationEl)
				.setName("New chat file location")
				.setDesc("New chat files will be placed here.")
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

		// Ensure toolSettings exists (deep-merge guard for existing installs)
		if (!this.plugin.settings.toolSettings) {
			this.plugin.settings.toolSettings = { disabledTools: ["run_shell_command"], maxToolCalls: 10, shellCommandOptedIn: false };
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
		const webSearchEnabled = this.plugin.settings.searxngSettings?.enabled ?? false;
		const disabledTools = this.plugin.settings.toolSettings.disabledTools;

		for (const tool of ALL_TOOL_DEFINITIONS) {
			const setting = new Setting(toolsItems);

			// Build the name element: risk badge + display name
			const nameFragment = activeDocument.createDocumentFragment();
			const badge = nameFragment.createEl("span", {
				cls: `llm-tool-badge llm-tool-badge-${tool.risk}`,
				text: tool.risk,
			});
			nameFragment.appendChild(badge);
			nameFragment.appendChild(activeDocument.createTextNode(" " + tool.displayName));
			setting.nameEl.appendChild(nameFragment);

			// Description: tool description + optional dependency notes
			let desc = tool.description;
			if (tool.requiresRag && !ragEnabled) {
				desc += " ⚠ Requires Embeddings to be enabled.";
			}
			if (tool.requiresWebSearch && !webSearchEnabled) {
				desc += " ⚠ Requires Web Search (SearXNG) to be enabled in Obsidian Agent settings.";
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
					if (enabled && tool.requiresShellConfirm) {
						// Revert the toggle immediately; only commit after user confirms
						toggle.setValue(false);
						new ShellCommandWarningModal(this.app, async () => {
							this.plugin.settings.toolSettings.shellCommandOptedIn = true;
							const idx = this.plugin.settings.toolSettings.disabledTools.indexOf(tool.name);
							if (idx !== -1) this.plugin.settings.toolSettings.disabledTools.splice(idx, 1);
							await this.plugin.saveSettings();
							toggle.setValue(true);
						}).open();
						return;
					}
					if (!enabled && tool.requiresShellConfirm) {
						this.plugin.settings.toolSettings.shellCommandOptedIn = false;
					}
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

	private renderEmbeddings() {
		const el = this.mainContentEl;
		// Embedding configuration
		const embeddingItems = this.addSettingGroup(el);

		const rag = this.plugin.settings.ragSettings;
		const currentProvider = rag.embeddingProvider ?? "onnx";

		// Provider selector
		new Setting(embeddingItems)
			.setName("Embedding provider")
			.setDesc("ONNX runs in-process (no server needed). External providers use your existing API keys / local servers.")
			.addDropdown((dropdown) => {
				dropdown.addOption("onnx", "ONNX (local, no server)");
				dropdown.addOption("ollama", "Ollama");
				dropdown.addOption("openai", "OpenAI");
				dropdown.addOption("gemini", "Gemini");
				dropdown.addOption("lmStudio", "LM Studio");
				dropdown.setValue(currentProvider);
				dropdown.onChange(async (value) => {
					this.plugin.settings.ragSettings.embeddingProvider = value as EmbeddingProvider;
					this.plugin.settings.ragSettings.embeddingModel = DEFAULT_EMBEDDING_MODELS[value as EmbeddingProvider];
					await this.plugin.saveSettings();
					this.plugin.initVaultIndexer();
					if (this.plugin.vaultIndexer) {
						await this.plugin.vaultIndexer.clearIndex();
						new Notice("Embedding provider changed — re-indexing vault…");
						this.plugin.vaultIndexer.indexVault(this.plugin.settings.ragSettings.excludedFolders)
							.then(async ({ indexed, skipped }) => {
								this.plugin.settings.ragSettings.lastIndexed = Date.now();
								this.plugin.settings.ragSettings.indexedFileCount = this.plugin.vaultIndexer!.indexedFileCount;
								await this.plugin.saveSettings();
								new Notice(`✓ Vault indexed — ${indexed} updated, ${skipped} unchanged.`);
							})
							.catch((e: unknown) => new Notice(`Indexing failed: ${getErrorMessage(e)}`));
					}
					// Re-render so provider-specific UI appears
					this.renderTab("embeddings");
				});
			});

		// Provider-specific controls
		if (currentProvider === "onnx") {
			// ONNX: show download/load button with status
			const loaded = EmbeddingService.isOnnxLoaded();
			const cached = rag.modelCached;
			const modelStatusSetting = new Setting(embeddingItems)
				.setName("Model status")
				.setDesc(
					loaded
						? "Model ready — Xenova/all-mpnet-base-v2 (runs in-process)"
						: cached
							? "Model cached — will load on next use"
							: "Model not downloaded (~90 MB on first use)"
				);

			modelStatusSetting.addButton((button) => {
				button.setButtonText(loaded ? "Loaded" : cached ? "Load now" : "Download & load");
				if (loaded) button.setDisabled(true);
				button.onClick(async () => {
					button.setButtonText("Downloading…");
					button.setDisabled(true);
					modelStatusSetting.setDesc("Downloading model…");
					try {
						await EmbeddingService.loadOnnx((progress) => {
							modelStatusSetting.setDesc(`Downloading… ${Math.round(progress)}%`);
						});
						this.plugin.settings.ragSettings.modelCached = true;
						await this.plugin.saveSettings();
						this.plugin.initVaultIndexer();
						modelStatusSetting.setDesc("Model ready — Xenova/all-mpnet-base-v2 (runs in-process)");
						button.setButtonText("Loaded");
						button.setDisabled(true);
						new Notice("✓ Embedding model loaded successfully.");
					} catch (e) {
						new Notice(`Failed to load embedding model: ${getErrorMessage(e)}`);
						modelStatusSetting.setDesc("Download failed — check console for details.");
						button.setButtonText(cached ? "Retry" : "Download & load");
						button.setDisabled(false);
					}
				});
			});
		} else {
			// External providers: show model name field and a note about prerequisites
			const providerLabels: Record<string, string> = {
				openai: "Uses your OpenAI API key from the API Keys settings.",
				gemini: "Uses your Gemini API key from the API Keys settings.",
				ollama: `Uses your Ollama server (${this.plugin.settings.ollamaHost ?? "http://localhost:11434"}). Ensure the model is pulled.`,
				lmStudio: `Uses your LM Studio server (${this.plugin.settings.lmStudioHost ?? "http://localhost:1234"}). Load an embedding model in LM Studio first.`,
			};

			new Setting(embeddingItems)
				.setName("Embedding model")
				.setDesc(providerLabels[currentProvider] ?? "")
				.addText((text) => {
					text.setPlaceholder(DEFAULT_EMBEDDING_MODELS[currentProvider]);
					text.setValue(rag.embeddingModel || DEFAULT_EMBEDDING_MODELS[currentProvider]);
					text.onChange(async (value) => {
						this.plugin.settings.ragSettings.embeddingModel = value || DEFAULT_EMBEDDING_MODELS[currentProvider];
						await this.plugin.saveSettings();
						this.plugin.initVaultIndexer();
						if (this.plugin.vaultIndexer) {
							await this.plugin.vaultIndexer.clearIndex();
							new Notice("Embedding model changed — re-indexing vault…");
							this.plugin.vaultIndexer.indexVault(this.plugin.settings.ragSettings.excludedFolders)
								.then(async ({ indexed, skipped }) => {
									this.plugin.settings.ragSettings.lastIndexed = Date.now();
									this.plugin.settings.ragSettings.indexedFileCount = this.plugin.vaultIndexer!.indexedFileCount;
									await this.plugin.saveSettings();
									new Notice(`✓ Vault indexed — ${indexed} updated, ${skipped} unchanged.`);
								})
								.catch((e: unknown) => new Notice(`Indexing failed: ${getErrorMessage(e)}`));
						}
					});
				});
		}

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
		const lastIndexedText = rag.lastIndexed
			? `Last indexed: ${new Date(rag.lastIndexed).toLocaleString()} · ${rag.indexedFileCount} file(s)`
			: "Not yet indexed.";

		const indexSetting = new Setting(indexItems)
			.setName("Index vault")
			.setDesc(lastIndexedText)
			.addButton((button) => {
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
						this.renderTab("embeddings");
					} catch (e) {
						new Notice(`Indexing failed: ${getErrorMessage(e)}`);
						indexSetting.setDesc(lastIndexedText);
						button.setButtonText("Index now");
						button.setDisabled(false);
					}
				});
			});
	}

	private renderSkills() {
		const el = this.mainContentEl;
		const skillsFolder = this.plugin.skillsFolder;

		if (!skillsFolder) {
			el.createEl("p", {
				cls: "pane-empty",
				text: "Set a Root Vault Folder in General settings to enable skills.",
			});
			return;
		}

		const skills = this.plugin.skillRegistry?.getSkills() ?? [];

		if (skills.length === 0) {
			el.createEl("p", {
				cls: "pane-empty",
				text: `No skills found in ${skillsFolder}. Add subfolders containing a SKILL.md file.`,
			});
			// Registry may not have loaded yet (onLayoutReady race). Reload once and
			// re-render only if skills are actually found, to avoid a flash loop.
			void this.plugin.skillRegistry?.reloadAll().then(() => {
				if (
					this.activeTab === "skills" &&
					(this.plugin.skillRegistry?.getSkills().length ?? 0) > 0
				) {
					this.renderTab("skills");
				}
			});
			return;
		}

		new Setting(el).setName("Skills").setHeading();
		new Setting(el).setDesc(
			`Enable or disable skills globally. Skills are invoked with / in the chat input or via the + menu. ` +
			`Skill files live in ${skillsFolder}.`
		);

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
		const toggleItems = this.addSettingGroup(el);

		new Setting(toggleItems)
			.setName("Enable memory")
			.setDesc(
				"Remember facts, preferences, and context across conversations. " +
				"Requires Embeddings to be enabled for recall."
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
				text: "⚠️ Memory recall requires Embeddings to be enabled. Enable it in the Embeddings tab.",
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

	}

	private renderProjects() {
		const el = this.mainContentEl;

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
							this.renderTab("projects");
							void new GuidanceEditorOverlay(this.plugin, this.modalEl, filePath, "").open();
						} else {
							new Notice("Failed to create project.");
						}
					});
			});

		// ── Existing projects ─────────────────────────────────────────────────
		const projects = this.plugin.projectManager?.getProjects() ?? [];
		if (projects.length === 0) return;

		const listGroup = this.addSettingGroup(el, `${projects.length} Project${projects.length === 1 ? "" : "s"}`);

		for (const project of projects) {
			const descParts: string[] = [];
			if (project.description) descParts.push(project.description);
			if (project.pinnedNotes.length > 0) {
				descParts.push(`${project.pinnedNotes.length} pinned note${project.pinnedNotes.length === 1 ? "" : "s"}`);
			}

			const setting = new Setting(listGroup)
				.setName(project.name)
				.setDesc(descParts.join(" · ") || project.id);

			// Edit: open PROJECT.md in overlay editor
			setting.addButton((btn) => {
				btn.setIcon("pencil")
					.setTooltip("Edit PROJECT.md")
					.onClick(() => {
						void new GuidanceEditorOverlay(this.plugin, this.modalEl, project.filePath, "").open();
					});
			});

			// Delete
			setting.addButton((btn) => {
				btn.setIcon("trash")
					.setTooltip("Delete project")
					.setDestructive()
					.onClick(async () => {
						await this.plugin.projectManager.deleteProject(project.id);
						new Notice(`Project "${project.name}" deleted.`);
						this.renderTab("projects");
					});
			});
		}
	}

	private renderAssistants() {
		const el = this.mainContentEl;

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
		if (assistants.length === 0) return;

		const listGroup = this.addSettingGroup(
			el,
			`${assistants.length} Assistant${assistants.length === 1 ? "" : "s"}`
		);

		for (const assistant of assistants) {
			const descParts: string[] = [];
			if (assistant.description) descParts.push(assistant.description);
			if (assistant.enabledSkills.length > 0) {
				descParts.push(`${assistant.enabledSkills.length} skill${assistant.enabledSkills.length === 1 ? "" : "s"}`);
			}
			if (assistant.allowedTools.length > 0) {
				descParts.push(`${assistant.allowedTools.length} tool${assistant.allowedTools.length === 1 ? "" : "s"}`);
			}

			const setting = new Setting(listGroup)
				.setName(assistant.name)
				.setDesc(descParts.join(" · ") || assistant.id);

			// Edit: open ASSISTANT.md in overlay editor
			setting.addButton((btn) => {
				btn.setIcon("pencil")
					.setTooltip("Edit ASSISTANT.md")
					.onClick(() => {
						void new GuidanceEditorOverlay(this.plugin, this.modalEl, assistant.filePath, "").open();
					});
			});

			// Delete
			setting.addButton((btn) => {
				btn.setIcon("trash")
					.setTooltip("Delete assistant")
					.setDestructive()
					.onClick(async () => {
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
					this.plugin.syncAllContainersAgentMode(value);
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

		// ── Web Search (SearXNG) ─────────────────────────────────────────────
		const searxngGroup = this.addSettingGroup(el, "Web Search");
		const searxng = this.plugin.settings.searxngSettings;

		new Setting(searxngGroup)
			.setName("Enable web search")
			.setDesc(
				"Allow the agent to search the web via a self-hosted SearXNG instance. " +
				"The web_search tool will be available to any tool-capable model."
			)
			.addToggle((toggle) => {
				toggle.setValue(searxng.enabled).onChange(async (value) => {
					this.plugin.settings.searxngSettings.enabled = value;
					await this.plugin.saveSettings();
					this.plugin.initSearxngService();
					this.renderTab("obsidian-agent");
				});
			});

		if (searxng.enabled) {
			new Setting(searxngGroup)
				.setName("SearXNG host")
				.setDesc("Base URL of your SearXNG instance (e.g. http://localhost:8080). No trailing slash.")
				.addText((text) => {
					text
						.setPlaceholder("http://localhost:8080")
						.setValue(searxng.host ?? "")
						.onChange(async (value) => {
							this.plugin.settings.searxngSettings.host = value.trim();
							await this.plugin.saveSettings();
							this.plugin.initSearxngService();
						});
					text.inputEl.style.width = "260px";
				})
				.addButton((btn) => {
					btn.setButtonText("Test connection").onClick(async () => {
						btn.setButtonText("Testing…");
						btn.setDisabled(true);
						try {
							const svc = this.plugin.searxngService;
							if (!svc) {
								new Notice("⚠ SearXNG is not initialised — check host and save settings.", 4000);
								return;
							}
							const ok = await svc.checkHealth();
							new Notice(ok ? "✓ SearXNG is reachable." : "✗ Could not reach SearXNG. Check the host URL.", 4000);
						} catch (e) {
							new Notice(`✗ Connection failed: ${getErrorMessage(e)}`, 5000);
						} finally {
							btn.setButtonText("Test connection");
							btn.setDisabled(false);
						}
					});
				});

			new Setting(searxngGroup)
				.setName("Max results per query")
				.setDesc("Maximum number of search results returned to the model (1–10).")
				.addSlider((slider) => {
					slider
						.setLimits(1, 10, 1)
						.setValue(searxng.maxResults ?? 5)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.searxngSettings.maxResults = value;
							await this.plugin.saveSettings();
							this.plugin.initSearxngService();
						});
				});
		}

		// ── Agent Guidance File ──────────────────────────────────────────────
		const guidanceGroup = this.addSettingGroup(el, "Agent Guidance");
		this.renderGuidanceFilePicker(
			guidanceGroup,
			"Guidance file",
			"Vault-relative path to your agent guidance note (e.g. AI/OBSIDIAN-AGENT.md). Tells the Obsidian Agent how to navigate this vault — its structure, naming conventions, routing rules, and off-limits folders. Only injected when the Obsidian Agent is active.",
			"AI/OBSIDIAN-AGENT.md",
			`# Obsidian Agent Guidance\n\nThis note guides the Obsidian Agent when working in this vault.\n\n## Vault Structure\n\n<!-- Describe your folder layout and what lives where. -->\n\n## Conventions\n\n<!-- Note naming conventions, file templates, frontmatter patterns, etc. -->\n\n## Routing Rules\n\n<!-- Describe when to delegate to specific assistants. -->\n\n## Off-Limits\n\n<!-- List folders or files the agent should never modify. -->\n`,
			() => this.plugin.settings.obsidianAgentSettings.agentGuidanceFile ?? "",
			async (value) => {
				this.plugin.settings.obsidianAgentSettings.agentGuidanceFile = value;
				await this.plugin.saveSettings();
			},
		);
	}

	// ── Transcription ─────────────────────────────────────────────────────────

	private renderTranscription() {
		const el = this.mainContentEl;

		const s = this.plugin.settings.whisperSettings;

		// ── Enable ───────────────────────────────────────────────────────────
		const enableGroup = this.addSettingGroup(el);
		new Setting(enableGroup)
			.setName("Enable Whisper transcription")
			.setDesc(
				"Adds a microphone button to the chat input for voice messages, and a " +
				'"Transcribe audio file" command for converting audio files to notes.'
			)
			.addToggle((toggle) => {
				toggle.setValue(s.enabled).onChange(async (value) => {
					this.plugin.settings.whisperSettings.enabled = value;
					await this.plugin.saveSettings();
					this.plugin.initWhisperService();
					this.plugin.refreshAllMicButtons();
					this.renderTab("transcription");
				});
			});

		if (!s.enabled) return;

		// ── Backend ──────────────────────────────────────────────────────────
		const backendGroup = this.addSettingGroup(el, "Backend");
		new Setting(backendGroup)
			.setName("Transcription backend")
			.setDesc(
				"OpenAI uses your existing API key — zero setup, audio sent to OpenAI. " +
				"Local sidecar uses a Python server running on your machine — fully private."
			)
			.addDropdown((dropdown) => {
				dropdown.addOption("openai",  "OpenAI Whisper API");
				dropdown.addOption("sidecar", "Local sidecar (whisper-server.py)");
				dropdown.setValue(s.backend);
				dropdown.onChange(async (value) => {
					this.plugin.settings.whisperSettings.backend = value as "openai" | "sidecar";
					await this.plugin.saveSettings();
					this.renderTab("transcription");
				});
			});

		// Backend-specific settings
		if (s.backend === "openai") {
			const hasKey = !!this.plugin.settings.openAIAPIKey;
			const keyNote = backendGroup.createEl("p", {
				cls: "setting-item-description",
				text: hasKey
					? "✓ OpenAI API key is configured. Uses the whisper-1 model."
					: "⚠ No OpenAI API key found. Add one under Settings → OpenAI.",
			});
			if (!hasKey) keyNote.addClass("llm-whisper-warning");
		} else {
			// Sidecar-specific settings
			new Setting(backendGroup)
				.setName("Sidecar server URL")
				.setDesc("URL of your running whisper-server.py instance.")
				.addText((text) => {
					text.setPlaceholder("http://localhost:8765");
					text.setValue(s.sidecarHost);
					text.onChange(async (value) => {
						this.plugin.settings.whisperSettings.sidecarHost = value;
						await this.plugin.saveSettings();
					});
				});

			new Setting(backendGroup)
				.setName("Model")
				.setDesc("Whisper model loaded by the sidecar. Larger models are more accurate but slower and require more RAM.")
				.addDropdown((dropdown) => {
					const whisperModels = [
						"tiny", "tiny.en",
						"base", "base.en",
						"small", "small.en",
						"medium", "medium.en",
						"large-v2", "large-v3",
					];
					for (const m of whisperModels) dropdown.addOption(m, m);
					dropdown.setValue(s.whisperModel || "medium.en");
					dropdown.onChange(async (value) => {
						this.plugin.settings.whisperSettings.whisperModel = value;
						await this.plugin.saveSettings();
					});
				});

			// ── Interactive sidecar setup wizard ────────────────────────────
			const setupGroup = this.addSettingGroup(el, "Sidecar Setup");

			// Status rows
			const pythonRow = setupGroup.createDiv({ cls: "llm-whisper-env-row" });
			const depsRow   = setupGroup.createDiv({ cls: "llm-whisper-env-row" });
			const serverRow = setupGroup.createDiv({ cls: "llm-whisper-env-row" });

			const setRow = (
				row:    HTMLElement,
				icon:   string,
				label:  string,
				mod:    "ok" | "warn" | "err" | "checking",
			) => {
				row.empty();
				const iconEl  = row.createSpan({ cls: `llm-whisper-env-icon llm-whisper-env-${mod}` });
				iconEl.textContent = icon;
				row.createSpan({ cls: "llm-whisper-env-label", text: label });
			};

			// Placeholders while we check
			setRow(pythonRow, "⏳", "Checking Python…",      "checking");
			setRow(depsRow,   "⏳", "Checking dependencies…", "checking");
			setRow(serverRow, "⏳", "Checking server…",       "checking");

			// Output log (shown during install / server startup)
			const logEl = setupGroup.createEl("pre", { cls: "llm-whisper-setup-log llm-hidden" });

			// Action buttons
			const btnRow      = setupGroup.createDiv({ cls: "llm-whisper-btn-row" });
			let installBtn: ButtonComponent | null = null;
			let serverBtn:  ButtonComponent | null = null;
			let pollTimer:  ReturnType<typeof setInterval> | null = null;

			// Stop auto-polling whenever we leave the tab or rebuild
			const stopPolling = () => {
				if (pollTimer !== null) { clearInterval(pollTimer); pollTimer = null; }
			};

			const refreshStatus = async () => {
				const mgr    = this.plugin.sidecarManager;
				const status = await mgr.getEnvStatus();

				// Python row
				if (status.python.found) {
					setRow(pythonRow, "✓", `Python ${status.python.version}`, "ok");
				} else {
					setRow(pythonRow, "✗", "Python 3 not found", "err");
					const link = pythonRow.createEl("a", {
						text: " → Download Python",
						href: "#",
						cls:  "llm-whisper-env-link",
					});
					link.addEventListener("click", (e) => {
						e.preventDefault();
						mgr.openPythonDownloadPage();
					});
				}

				// Deps row
				if (!status.python.found) {
					setRow(depsRow, "–", "Install Python first", "warn");
				} else if (status.deps.installed) {
					setRow(depsRow, "✓", "Dependencies installed", "ok");
				} else {
					setRow(depsRow, "✗", `Missing: ${status.deps.missing.join(", ")}`, "err");
				}

				// Server row
				const serverOwned = this.plugin.sidecarManager.isServerOwned;
				if (status.server.running) {
					setRow(serverRow, "✓", `Server running — model: ${status.server.model}`, "ok");
					stopPolling(); // health confirmed — no need to keep polling
				} else if (serverOwned) {
					setRow(serverRow, "⏳", "Server starting… (model may be downloading)", "checking");
					// Auto-poll every 5 s until the health endpoint responds
					if (pollTimer === null) {
						pollTimer = setInterval(async () => {
							const s = await this.plugin.sidecarManager.getServerStatus();
							if (s.running) {
								stopPolling();
								await refreshStatus();
							}
						}, 5000);
					}
				} else {
					setRow(serverRow, "○", "Server not running", "warn");
					stopPolling();
				}

				// Rebuild action buttons
				btnRow.empty();
				installBtn = null;
				serverBtn  = null;

				// "Install dependencies" — only when Python exists and deps are missing
				if (status.python.found && !status.deps.installed) {
					installBtn = new ButtonComponent(btnRow);
					installBtn.setButtonText("Install dependencies");
					installBtn.setCta();
					installBtn.onClick(async () => {
						installBtn!.setButtonText("Installing…");
						installBtn!.setDisabled(true);
						logEl.textContent = "";
						logEl.removeClass("llm-hidden");

						try {
							await this.plugin.sidecarManager.installDependencies((line) => {
								logEl.textContent += line + "\n";
								logEl.scrollTop = logEl.scrollHeight;
							});
							logEl.textContent += "\n✓ Done! Refreshing status…";
						} catch (err) {
							logEl.textContent += `\n✗ ${err instanceof Error ? err.message : String(err)}`;
						}

						await refreshStatus();
					});
				}

				// "Start server" / "Stop server"
				if (status.python.found && status.deps.installed) {
					serverBtn = new ButtonComponent(btnRow);
					if (status.server.running || this.plugin.sidecarManager.isServerOwned) {
						serverBtn.setButtonText("Stop server");
						serverBtn.onClick(async () => {
							this.plugin.sidecarManager.stopServer();
							await new Promise((r) => window.setTimeout(r, 800));
							await refreshStatus();
						});
					} else {
						serverBtn.setButtonText("Start server");
						serverBtn.setCta();
						serverBtn.onClick(async () => {
							logEl.textContent = "";
							logEl.removeClass("llm-hidden");
							this.plugin.sidecarManager.startServer((line) => {
								logEl.textContent += line + "\n";
								logEl.scrollTop = logEl.scrollHeight;
							});
							// Give the server 2 s to spin up then re-check
							serverBtn!.setButtonText("Starting…");
							serverBtn!.setDisabled(true);
							await new Promise((r) => window.setTimeout(r, 2500));
							await refreshStatus();
						});
					}
				}

				// Refresh button (always)
				const refreshBtn = new ButtonComponent(btnRow);
				refreshBtn.setButtonText("Refresh");
				refreshBtn.onClick(() => refreshStatus());
			};

			// Stop any stale poll if the tab is re-rendered (e.g. backend toggle)
			this.registerSidecarPollCleanup(stopPolling);

			// Kick off the initial check
			void refreshStatus();
		}

		// ── Test Connection ──────────────────────────────────────────────────
		const testGroup = this.addSettingGroup(el, "Connection");
		const statusEl  = testGroup.createEl("p", {
			cls: "setting-item-description llm-whisper-status",
		});

		new Setting(testGroup)
			.setName("Test connection")
			.setDesc("Verify the backend is reachable and the API key / server URL is correct.")
			.addButton((button) => {
				button.setButtonText("Test connection");
				button.onClick(async () => {
					button.setButtonText("Testing…");
					button.setDisabled(true);
					statusEl.setText("");
					statusEl.removeClass("llm-whisper-status-ok", "llm-whisper-status-err");

					if (!this.plugin.whisperService) this.plugin.initWhisperService();
					const result = await this.plugin.whisperService!.checkHealth();

					if (result.ok) {
						statusEl.setText(`✓ Connected — model: ${result.model}`);
						statusEl.addClass("llm-whisper-status-ok");
					} else {
						statusEl.setText(`✗ ${result.error ?? "Could not connect"}`);
						statusEl.addClass("llm-whisper-status-err");
					}

					button.setButtonText("Test connection");
					button.setDisabled(false);
				});
			});

		// ── Language ─────────────────────────────────────────────────────────
		const langGroup = this.addSettingGroup(el, "Transcription Options");
		new Setting(langGroup)
			.setName("Language")
			.setDesc(
				'ISO language code for transcription (e.g. "en", "ja", "fr"). ' +
				"Leave blank for automatic language detection."
			)
			.addText((text) => {
				text.setPlaceholder("auto-detect");
				text.setValue(s.language);
				text.onChange(async (value) => {
					this.plugin.settings.whisperSettings.language = value.trim();
					await this.plugin.saveSettings();
				});
			});

		new Setting(langGroup)
			.setName("Include timestamps")
			.setDesc("Prefix each segment with a [MM:SS] timestamp in transcription notes.")
			.addToggle((toggle) => {
				toggle.setValue(s.includeTimestamps).onChange(async (value) => {
					this.plugin.settings.whisperSettings.includeTimestamps = value;
					await this.plugin.saveSettings();
				});
			});

		// ── Voice input ───────────────────────────────────────────────────────
		const voiceGroup = this.addSettingGroup(el, "Voice Input");
		new Setting(voiceGroup)
			.setName("Auto-send voice transcript")
			.setDesc(
				"When enabled, voice recordings are sent as chat messages immediately after " +
				"transcription. When disabled, the transcript is placed in the input field for review first."
			)
			.addToggle((toggle) => {
				toggle.setValue(s.autoSend).onChange(async (value) => {
					this.plugin.settings.whisperSettings.autoSend = value;
					await this.plugin.saveSettings();
				});
			});

		// ── File transcription ────────────────────────────────────────────────
		const fileGroup = this.addSettingGroup(el, "File Transcription");
		new Setting(fileGroup)
			.setName("Output folder")
			.setDesc('Vault folder where transcription notes are created (e.g. "Transcripts").')
			.addText((text) => {
				text.setPlaceholder("Transcripts");
				text.setValue(s.outputFolder);
				text.onChange(async (value) => {
					this.plugin.settings.whisperSettings.outputFolder = value.trim() || "Transcripts";
					await this.plugin.saveSettings();
				});
			});

		new Setting(fileGroup)
			.setName("Auto-open note after transcription")
			.setDesc("Automatically open the created note when transcription completes.")
			.addToggle((toggle) => {
				toggle.setValue(s.autoOpenNote).onChange(async (value) => {
					this.plugin.settings.whisperSettings.autoOpenNote = value;
					await this.plugin.saveSettings();
				});
			});
	}

	// ── Helpers ────────────────────────────────────────────────────────────────

	/**
	 * Register a cleanup callback that fires the next time renderTab() clears
	 * the main content area. Used to stop the sidecar status-poll interval when
	 * the user navigates away from the Transcription tab.
	 */
	private _sidecarPollCleanup: (() => void) | null = null;
	private registerSidecarPollCleanup(fn: () => void) {
		// Stop any previously registered cleanup first
		this._sidecarPollCleanup?.();
		this._sidecarPollCleanup = fn;
	}

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
						void this.plugin.saveSettings();
					});
				})
				.addText((text) => {
					text.setPlaceholder("API key");
					text.inputEl.type = "password";
					text.setValue(ws.apiKey);
					text.onChange((value) => {
						this.plugin.settings.linearWorkspaces[index].apiKey = value;
						void this.plugin.saveSettings();
					});
				})
				.addButton((button) => {
					button.setIcon("trash");
					button.setTooltip("Remove workspace");
					button.onClick(() => {
						this.plugin.settings.linearWorkspaces.splice(index, 1);
						void this.plugin.saveSettings();
						this.renderWorkspaceList(containerEl);
					});
				});
			row.setName(ws.name || `Workspace ${index + 1}`);
		});
	}
}

// ── Guidance file inline editor ───────────────────────────────────────────────
// Uses a plain overlay div rendered inside the parent modal's containerEl
// rather than extending Modal, so closing it never touches the parent modal's
// keymap scope or background-click handlers.

class GuidanceEditorOverlay {
	private plugin: LLMPlugin;
	private parentEl: HTMLElement;
	private filePath: string;
	private template: string;
	private overlayEl: HTMLElement | null = null;

	constructor(plugin: LLMPlugin, parentEl: HTMLElement, filePath: string, template: string) {
		this.plugin = plugin;
		this.parentEl = parentEl;
		this.filePath = filePath;
		this.template = template;
	}

	async open() {
		const app = this.plugin.app;

		// ── Ensure file exists ────────────────────────────────────────────────
		let tfile = app.vault.getAbstractFileByPath(this.filePath);
		if (!(tfile instanceof TFile)) {
			const dir = this.filePath.includes("/")
				? this.filePath.substring(0, this.filePath.lastIndexOf("/"))
				: "";
			if (dir) {
				try { await app.vault.adapter.mkdir(dir); } catch { /* already exists */ }
			}
			try {
				tfile = await app.vault.create(this.filePath, this.template);
			} catch (e) {
				new Notice(`Could not create ${this.filePath}: ${String(e)}`);
				return;
			}
		}

		const content = await app.vault.read(tfile as TFile);
		const fileName = this.filePath.includes("/")
			? this.filePath.substring(this.filePath.lastIndexOf("/") + 1)
			: this.filePath;

		// ── Overlay (fills the parent modal container) ────────────────────────
		this.overlayEl = this.parentEl.createDiv({ cls: "llm-guidance-editor-overlay" });

		// ── Inner panel (styled like an Obsidian modal) ───────────────────────
		const panel = this.overlayEl.createDiv({ cls: "llm-guidance-editor-panel" });

		// Header
		panel.createEl("h2", { text: fileName, cls: "llm-guidance-editor-title" });
		panel.createEl("p", { text: this.filePath, cls: "llm-guidance-editor-path" });

		// Textarea
		const textarea = panel.createEl("textarea", { cls: "llm-guidance-editor-textarea" });
		textarea.value = content;

		requestAnimationFrame(() => {
			textarea.focus();
			textarea.setSelectionRange(0, 0);
			textarea.scrollTop = 0;
		});

		// Buttons
		const buttonRow = panel.createDiv({ cls: "modal-button-container" });

		new ButtonComponent(buttonRow)
			.setButtonText("Cancel")
			.onClick(() => this.close());

		new ButtonComponent(buttonRow)
			.setButtonText("Save")
			.setCta()
			.onClick(async () => {
				const file = app.vault.getAbstractFileByPath(this.filePath);
				if (file instanceof TFile) {
					await app.vault.modify(file, textarea.value);
					new Notice(`Saved ${fileName}`);
					this.plugin.refreshAllChips?.();
				}
				this.close();
			});

		// Clicking the backdrop (outside the panel) also cancels
		this.overlayEl.addEventListener("click", (e) => {
			if (e.target === this.overlayEl) this.close();
		});
	}

	close() {
		this.overlayEl?.remove();
		this.overlayEl = null;
	}
}

class ShellCommandWarningModal extends Modal {
	constructor(app: App, private onConfirm: () => void) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "⚠ Enable Shell Command Tool?" });
		contentEl.createEl("p", {
			text: "The run_shell_command tool lets the AI execute arbitrary shell commands on your computer — it can read, write, or delete any file and run any program.",
		});
		contentEl.createEl("p", {
			text: "Only enable this if you understand the risks and trust the prompts you send to the agent. A rogue or poorly-worded prompt could cause irreversible damage.",
		});
		contentEl.createEl("p", {
			cls: "llm-shell-warning-note",
			text: "Tip: use it for read-only tasks like 'git log' or 'grep' — avoid prompts that ask the agent to write or delete files via the shell.",
		});

		const btnRow = contentEl.createDiv({ cls: "llm-shell-warning-buttons" });
		new ButtonComponent(btnRow)
			.setButtonText("Cancel")
			.onClick(() => this.close());
		new ButtonComponent(btnRow)
			.setButtonText("Yes, enable shell commands")
			.setDestructive()
			.onClick(() => {
				this.close();
				this.onConfirm();
			});
	}

	onClose() {
		this.contentEl.empty();
	}
}
