import { Plugin, WorkspaceLeaf, Platform } from "obsidian";
import {
	HistoryItem,
	ImageQuality,
	ImageSize,
	RAGSettings,
	ResponseFormat,
	SkillsSettings,
	ViewSettings,
} from "./Types/types";
import { SkillRegistry } from "Skills/SkillRegistry";
import { VaultIndexer } from "RAG/VaultIndexer";
import { VectorStore } from "RAG/VectorStore";
import { EmbeddingService, DEFAULT_EMBEDDING_MODELS } from "RAG/EmbeddingService";

import { History } from "History/HistoryHandler";
import { ChatHistory } from "services/ChatHistory";
import { FAB } from "Plugin/FAB/FAB";
import { StatusBarButton } from "Plugin/StatusBar/StatusBarButton";
import { RecentChatsButton } from "Plugin/StatusBar/RecentChatsButton";
import { ChatModal2 } from "Plugin/Modal/ChatModal2";
import { TAB_VIEW_TYPE, WidgetView } from "Plugin/Widget/Widget";
import SettingsView from "Settings/SettingsView";
import { getApiKeyValidity } from "utils/utils";
import { models, modelNames, buildOllamaModels, buildLMStudioModels } from "utils/models";
import {
	chat,
	claudeSonnet46Model,
	claudeOpus46Model,
	claudeHaiku45Model,
	gemini2FlashStableModel,
	gemini2FlashLiteModel,
	gemini25ProModel,
	gemini25FlashModel,
	gemini25FlashLiteModel,
	gemini3ProPreviewModel,
	geminiFlashLatestModel,
	geminiFlashLiteLatestModel,
	openAIModel,
	openAI,
	claude,
	gemini,
} from "utils/constants";
import { ConversationRegistry } from "Plugin/Components/ConversationRegistry";
import {
	DesktopOperatingSystem,
	MobileOperatingSystem,
	OperatingSystem,
} from "services/OperatingSystem";
import {
	DesktopFileSystem,
	MobileFileSystem,
	FileSystem,
} from "services/FileSystem";

export interface LLMPluginSettings {
	currentIndex: number;
	currentView: string | null;
	modalSettings: ViewSettings;
	widgetSettings: ViewSettings;
	fabSettings: ViewSettings;
	promptHistory: HistoryItem[];
	chatHistoryEnabled: boolean;
	chatHistoryMigrated: boolean;
	chatHistoryFolder: string;
	claudeAPIKey: string;
	claudeCodeOAuthToken: string;
	linearWorkspaces: Array<{ name: string; apiKey: string }>;
	geminiAPIKey: string;
	mistralAPIKey: string;
	openAIAPIKey: string;
	GPT4AllStreaming: boolean;
	showFAB: boolean;
	showRibbonIcon: boolean;
	enableFileContext: boolean;
	defaultModel: string;
	ollamaHost: string;
	ollamaModels: string[];
	lmStudioHost: string;
	lmStudioModels: string[];
	emptyChatAvatar: string;
	fabViewHeight?: number;
	showStatusBarButton: boolean;
	ragSettings: RAGSettings;
	skillsSettings: SkillsSettings;
}

const defaultSettings = {
	model: "gpt-3.5-turbo",
	modelName: "ChatGPT-3.5 turbo",
	modelType: "openAI",
	modelEndpoint: chat,
	endpointURL: "/chat/completions",
	historyIndex: -1,
	historyFilePath: null as string | null,
	imageSettings: {
		numberOfImages: 1,
		response_format: "url" as ResponseFormat,
		size: "1024x1024" as ImageSize,
		quality: "medium" as ImageQuality,
	},
	chatSettings: {
		maxTokens: 0,
		temperature: 0.65,
		GPT4All: {},
		openAI: {
			frequencyPenalty: 0,
			logProbs: false,
			topLogProbs: null,
			presencePenalty: 0,
			responseFormat: "",
			topP: 1,
		},
	},
	contextSettings: {
		includeActiveFile: true,
		includeSelection: true,
		selectedFiles: [],
		maxContextTokensPercent: 70, // 70% for context, 30% for response
	},
	agentSettings: {
		permissionMode: "ask" as import("./Types/types").PermissionMode,
	},
};

export const DEFAULT_SETTINGS: LLMPluginSettings = {
	currentIndex: -1,
	currentView: null,
	modalSettings: {
		...defaultSettings,
	},
	widgetSettings: {
		...defaultSettings,
	},
	fabSettings: {
		...defaultSettings,
	},
	promptHistory: [],
	chatHistoryEnabled: false,
	chatHistoryMigrated: false,
	chatHistoryFolder: "LLM Chats",
	openAIAPIKey: "",
	claudeAPIKey: "",
	mistralAPIKey: "",
	claudeCodeOAuthToken: "",
	linearWorkspaces: [],
	geminiAPIKey: "",
	GPT4AllStreaming: false,
	//this setting determines whether or not fab is shown by default
	showFAB: false,
	showRibbonIcon: true,
	enableFileContext: false,
	defaultModel: "",
	ollamaHost: "http://localhost:11434",
	ollamaModels: [],
	lmStudioHost: "http://localhost:1234",
	lmStudioModels: [],
	emptyChatAvatar: "llm-gal",
	showStatusBarButton: false,
	ragSettings: {
		enabled: false,
		embeddingProvider: "openai",
		embeddingModel: DEFAULT_EMBEDDING_MODELS["openai"],
		excludedFolders: [],
		topK: 5,
		lastIndexed: null,
		indexedFileCount: 0,
	},
	skillsSettings: {
		folder: "LLM-Skills",
		enabledSkills: {},
	},
};

export default class LLMPlugin extends Plugin {
	fileSystem: FileSystem;
	os: OperatingSystem;
	settings: LLMPluginSettings;
	history: History;
	chatHistory: ChatHistory;
	fab: FAB;
	conversationRegistry: ConversationRegistry;
	ribbonIconEl: HTMLElement | null = null;
	statusBarButton: StatusBarButton;
	recentChatsButton: RecentChatsButton;
	/** Transient — set before opening the widget so it can auto-load the right conversation. */
	pendingWidgetHistoryIndex: number = -1;
	/** Transient — set before opening the widget to auto-load a chat file by vault path. */
	pendingWidgetFilePath: string | null = null;
	/** RAG vault indexer — initialized after settings load, null if RAG is disabled or misconfigured. */
	vaultIndexer: VaultIndexer | null = null;
	/** Debounce timers keyed by file path — prevents hammering the embedding API on rapid saves. */
	private ragDebounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	/** Skills registry — always initialized; folder is configurable in settings. */
	skillRegistry: SkillRegistry;

	async onload() {
		this.fileSystem = Platform.isDesktop
			? new DesktopFileSystem()
			: new MobileFileSystem(this);
		this.os = Platform.isDesktop
			? new DesktopOperatingSystem()
			: new MobileOperatingSystem();
		await this.loadSettings();
		this.initVaultIndexer();
		this.registerRagVaultEvents();
		this.skillRegistry = new SkillRegistry(this.app);
		// Skills are in the vault — wait for the vault to finish loading before scanning
		this.app.workspace.onLayoutReady(async () => {
			await this.skillRegistry.setFolder(this.settings.skillsSettings.folder);
			this.registerSkillVaultEvents();
		});
		this.registerOllamaModels();
		this.registerLMStudioModels();
		await this.checkForAPIKeyBasedModel();
		this.registerRibbonIcons();
		this.registerCommands();
		this.conversationRegistry = new ConversationRegistry();
		this.settings.currentIndex = -1;
		await this.saveSettings();

		this.registerView(TAB_VIEW_TYPE, (tab) => new WidgetView(tab, this));

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.fab = new FAB(this);
		this.statusBarButton = new StatusBarButton(this);
		this.recentChatsButton = new RecentChatsButton(this, this.statusBarButton);
		this.addSettingTab(new SettingsView(this.app, this, this.fab));
		if (this.settings.showFAB) {
			setTimeout(() => {
				this.fab.regenerateFAB();
			}, 500);
		}
		if (this.settings.showStatusBarButton) {
			setTimeout(() => {
				this.statusBarButton.generate();
				this.recentChatsButton.generate();
			}, 500);
		}
		this.history = new History(this);
		this.chatHistory = new ChatHistory(this);
		this.registerChatFileViewAction();
	}

	/**
	 * Register a workspace event that adds a "Open in chat widget" action button
	 * to the view-actions area whenever a chat history file is the active note.
	 *
	 * Uses `active-leaf-change` (fires on every tab switch, not just first open)
	 * and reads the file directly from the leaf view to avoid metadata-cache timing issues.
	 */
	private registerChatFileViewAction() {
		let currentActionEl: HTMLElement | null = null;

		const tryAttach = (leaf: WorkspaceLeaf | null) => {
			currentActionEl?.remove();
			currentActionEl = null;

			if (!leaf) return;

			// MarkdownView exposes `.file`; other view types do not
			const view = leaf.view as any;
			const file = view?.file;
			if (!file || file.extension !== "md") return;

			// Only chat history files (folder check is sufficient — the folder is dedicated)
			const chatFolder = this.settings.chatHistoryFolder || "LLM Chats";
			if (!file.path.startsWith(chatFolder + "/")) return;

			if (typeof view.addAction !== "function") return;

			const filePath: string = file.path;
			currentActionEl = view.addAction(
				"bot-message-square",
				"Open in chat widget",
				async () => {
					await this.openChatFileInWidget(filePath);
				}
			);
		};

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				tryAttach(leaf);
			})
		);
	}

	/**
	 * Re-renders the empty state in every open chat view so display setting
	 * changes (e.g. avatar) are visible immediately without a plugin reload.
	 */
	refreshAllEmptyStates() {
		this.fab.refreshEmptyState();
		this.statusBarButton.refreshEmptyState();
		this.app.workspace.getLeavesOfType(TAB_VIEW_TYPE).forEach((leaf: WorkspaceLeaf) => {
			(leaf.view as WidgetView).refreshEmptyState();
		});
	}

	/** Open a chat markdown file in the widget tab, creating the widget if needed. */
	async openChatFileInWidget(filePath: string): Promise<void> {
		const { workspace } = this.app;
		const tabs = workspace.getLeavesOfType(TAB_VIEW_TYPE);

		if (tabs.length > 0) {
			// Widget already open — load directly
			const leaf = tabs[0];
			workspace.revealLeaf(leaf);
			await (leaf.view as WidgetView).loadChatFile(filePath);
		} else {
			// Widget not open — set pending path and open a new tab; onOpen() will load it
			this.pendingWidgetFilePath = filePath;
			const leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: TAB_VIEW_TYPE, active: true });
			workspace.revealLeaf(leaf);
		}
	}

	/**
	 * Register vault file events to keep the RAG index incrementally up-to-date.
	 * Modify events are debounced (2 s) so rapid autosaves don't hammer the embedding API.
	 * Uses Obsidian's registerEvent so listeners are automatically cleaned up on unload.
	 */
	private registerRagVaultEvents(): void {
		const DEBOUNCE_MS = 2000;

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!this.vaultIndexer || !this.settings.ragSettings?.enabled) return;
				if (!(file as any).extension || (file as any).extension !== "md") return;

				const path = file.path;
				const existing = this.ragDebounceTimers.get(path);
				if (existing) clearTimeout(existing);

				const timer = setTimeout(async () => {
					this.ragDebounceTimers.delete(path);
					try {
						await this.vaultIndexer!.indexFile(file as import("obsidian").TFile);
						await this.vaultIndexer!.save();
						this.settings.ragSettings.lastIndexed = Date.now();
						this.settings.ragSettings.indexedFileCount = this.vaultIndexer!.indexedFileCount;
						await this.saveSettings();
						console.log("[RAG] Auto-reindexed:", path);
					} catch (e) {
						console.error("[RAG] Auto-reindex failed for", path, e);
					}
				}, DEBOUNCE_MS);

				this.ragDebounceTimers.set(path, timer);
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (!this.vaultIndexer || !this.settings.ragSettings?.enabled) return;
				if ((file as any).extension !== "md") return;

				// Cancel any pending reindex for this file
				const timer = this.ragDebounceTimers.get(file.path);
				if (timer) {
					clearTimeout(timer);
					this.ragDebounceTimers.delete(file.path);
				}

				this.vaultIndexer.removeFile(file.path)
					.then(async () => {
						this.settings.ragSettings.indexedFileCount = this.vaultIndexer!.indexedFileCount;
						await this.saveSettings();
					})
					.catch((e) => {
						console.error("[RAG] Failed to remove deleted file from index:", file.path, e);
					});
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (!this.vaultIndexer || !this.settings.ragSettings?.enabled) return;
				if ((file as any).extension !== "md") return;

				// Remove old path, re-index under new path
				this.vaultIndexer.removeFile(oldPath).catch(() => {});
				this.vaultIndexer.indexFile(file as import("obsidian").TFile)
					.then(async () => {
						await this.vaultIndexer!.save();
						this.settings.ragSettings.lastIndexed = Date.now();
						this.settings.ragSettings.indexedFileCount = this.vaultIndexer!.indexedFileCount;
						await this.saveSettings();
					})
					.catch((e) => console.error("[RAG] Failed to reindex renamed file:", e));
			})
		);
	}

	/**
	 * Build (or rebuild) the VaultIndexer from current ragSettings.
	 * Safe to call after any settings change that affects RAG configuration.
	 */
	initVaultIndexer(): void {
		const rag = this.settings.ragSettings;
		if (!rag?.enabled) {
			this.vaultIndexer = null;
			return;
		}
		const embeddingService = new EmbeddingService({
			provider: rag.embeddingProvider,
			model: rag.embeddingModel,
			openAIKey: this.settings.openAIAPIKey,
			geminiKey: this.settings.geminiAPIKey,
			ollamaHost: this.settings.ollamaHost,
			lmStudioHost: this.settings.lmStudioHost,
		});
		const indexPath = `${this.manifest.dir}/rag-index.json`;
		const store = new VectorStore(this.app, indexPath);
		this.vaultIndexer = new VaultIndexer(this.app, store, embeddingService);
	}

	/**
	 * Re-initialise the SkillRegistry from current settings.
	 * Call after the skills folder setting changes.
	 */
	async reinitSkillRegistry(): Promise<void> {
		await this.skillRegistry.setFolder(this.settings.skillsSettings.folder);
	}

	/**
	 * Register vault events to keep the SkillRegistry hot-reloaded whenever
	 * SKILL.md files inside the skills folder are created, modified, or deleted.
	 */
	private registerSkillVaultEvents(): void {
		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (!(file instanceof (await import("obsidian")).TFile)) return;
				if (this.skillRegistry.isSkillFile(file.path)) {
					await this.skillRegistry.loadSkillFile(file as any);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (!(file instanceof (await import("obsidian")).TFile)) return;
				if (this.skillRegistry.isSkillFile(file.path)) {
					await this.skillRegistry.loadSkillFile(file as any);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.skillRegistry.isSkillFile(file.path)) {
					this.skillRegistry.removeByPath(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				// Remove old entry if it was a skill file
				if (this.skillRegistry.isSkillFile(oldPath)) {
					this.skillRegistry.removeByPath(oldPath);
				}
				// Register new path if it's now a skill file
				if (
					this.skillRegistry.isSkillFile(file.path) &&
					file instanceof (await import("obsidian")).TFile
				) {
					await this.skillRegistry.loadSkillFile(file as any);
				}
			})
		);
	}

	onunload() {
		this.fab.removeFab();
		this.statusBarButton.remove();
		this.recentChatsButton.remove();
	}

	private registerCommands() {
		this.addCommand({
			id: "open-llm-modal",
			name: "Open modal",
			callback: () => {
				new ChatModal2(this).open();
			},
		});

		this.addCommand({
			id: "open-LLM-widget-tab",
			name: "Open chat in tab",
			callback: () => {
				this.activateTab();
			},
		});

		this.addCommand({
			id: "toggle-LLM-fab",
			name: "Toggle FAB",
			callback: () => {
				const currentFABState = this.settings.showFAB;
				this.settings.showFAB = !currentFABState;
				this.saveSettings();
				this.settings.showFAB
					? this.fab.regenerateFAB()
					: this.fab.removeFab();
			},
		});
	}

	private registerOllamaModels() {
		if (this.settings.ollamaModels.length > 0) {
			const built = buildOllamaModels(this.settings.ollamaModels);
			Object.assign(models, built.models);
			Object.assign(modelNames, built.names);
		}
	}

	private registerLMStudioModels() {
		if (this.settings.lmStudioModels.length > 0) {
			const built = buildLMStudioModels(this.settings.lmStudioModels);
			Object.assign(models, built.models);
			Object.assign(modelNames, built.names);
		}
	}

	private registerRibbonIcons() {
		if (this.settings.showRibbonIcon) {
			this.ribbonIconEl = this.addRibbonIcon("bot", "Ask a question", (evt: MouseEvent) => {
				new ChatModal2(this).open();
			});
		}
	}

	async activateTab() {
		const { workspace } = this.app;
		const pendingIndex = this.pendingWidgetHistoryIndex;
		const pendingFilePath = this.pendingWidgetFilePath;

		let tab: WorkspaceLeaf | null = null;
		const tabs = workspace.getLeavesOfType(TAB_VIEW_TYPE);

		if (tabs.length > 0) {
			tab = tabs[0];
			// View already exists — load conversation directly if one is pending.
			if (pendingFilePath) {
				this.pendingWidgetFilePath = null;
				await (tab.view as WidgetView).loadChatFile(pendingFilePath);
			} else if (pendingIndex >= 0) {
				this.pendingWidgetHistoryIndex = -1;
				(tab.view as WidgetView).loadConversation(pendingIndex);
			}
		} else {
			tab = workspace.getLeaf("tab");
			await tab.setViewState({ type: TAB_VIEW_TYPE, active: true });
			// onOpen will handle auto-loading via pendingWidgetHistoryIndex / pendingWidgetFilePath.
		}
		workspace.revealLeaf(tab);
	}

	async activateSidebar() {
		const { workspace } = this.app;
		const pendingIndex = this.pendingWidgetHistoryIndex;
		const pendingFilePath = this.pendingWidgetFilePath;

		// Look for an existing widget leaf in the right sidebar.
		const leaves = workspace.getLeavesOfType(TAB_VIEW_TYPE);
		const sidebarLeaf = leaves.find(
			(l) => l.getRoot() === workspace.rightSplit
		);

		let leaf: WorkspaceLeaf;
		if (sidebarLeaf) {
			leaf = sidebarLeaf;
			// View already exists — load conversation directly if one is pending.
			if (pendingFilePath) {
				this.pendingWidgetFilePath = null;
				await (leaf.view as WidgetView).loadChatFile(pendingFilePath);
			} else if (pendingIndex >= 0) {
				this.pendingWidgetHistoryIndex = -1;
				(leaf.view as WidgetView).loadConversation(pendingIndex);
			}
		} else {
			leaf = workspace.getRightLeaf(false)!;
			await leaf.setViewState({ type: TAB_VIEW_TYPE, active: true });
			// onOpen will handle auto-loading via pendingWidgetHistoryIndex / pendingWidgetFilePath.
		}
		workspace.revealLeaf(leaf);
	}

	async loadSettings() {
		const dataJSON = await this.loadData();
		if (dataJSON) {
			this.settings = Object.assign({}, DEFAULT_SETTINGS, dataJSON);

			// Deep-merge view settings so nested defaults (e.g. contextSettings) are preserved
			const viewKeys = ["modalSettings", "widgetSettings", "fabSettings"] as const;
			for (const key of viewKeys) {
				this.settings[key] = {
					...defaultSettings,
					...dataJSON[key],
					contextSettings: {
						...defaultSettings.contextSettings,
						...(dataJSON[key]?.contextSettings),
					},
					chatSettings: {
						...defaultSettings.chatSettings,
						...(dataJSON[key]?.chatSettings),
					},
					imageSettings: {
						...defaultSettings.imageSettings,
						...(dataJSON[key]?.imageSettings),
					},
					agentSettings: {
						...defaultSettings.agentSettings,
						...(dataJSON[key]?.agentSettings),
					},
				};
			}

			this.settings.fabSettings.historyIndex = -1;
			this.settings.widgetSettings.historyIndex = -1;

			// Deep-merge ragSettings so new fields get defaults if missing from saved data
			this.settings.ragSettings = {
				...DEFAULT_SETTINGS.ragSettings,
				...(dataJSON.ragSettings ?? {}),
			};

			// Deep-merge skillsSettings
			this.settings.skillsSettings = {
				...DEFAULT_SETTINGS.skillsSettings,
				...(dataJSON.skillsSettings ?? {}),
				enabledSkills: {
					...DEFAULT_SETTINGS.skillsSettings.enabledSkills,
					...(dataJSON.skillsSettings?.enabledSkills ?? {}),
				},
			};

			// Ensure emptyChatAvatar is a valid known value; fall back to default
			// if the saved value is missing or was corrupted (e.g. from a partial write).
			const validAvatars = ["llm-gal", "llm-guy", "zen-kid", "ninja-cat"];
			if (!validAvatars.includes(this.settings.emptyChatAvatar)) {
				this.settings.emptyChatAvatar = DEFAULT_SETTINGS.emptyChatAvatar;
			}

			// Migrate linearApiKey → linearWorkspaces
			if ((dataJSON as any).linearApiKey && !dataJSON.linearWorkspaces) {
				this.settings.linearWorkspaces = [
					{ name: "Linear", apiKey: (dataJSON as any).linearApiKey },
				];
				delete (this.settings as any).linearApiKey;
				await this.saveSettings();
			}
		} else {
			this.settings = Object.assign({}, DEFAULT_SETTINGS);
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async validateActiveModelsAPIKeys() {
		let activeClaudeModel, activeGeminiModel, activeOpenAIModel;

		const settingsObjects = [
			this.settings.modalSettings,
			this.settings.widgetSettings,
			this.settings.fabSettings,
		];

		settingsObjects.forEach((settings) => {
			const model = settings.model;
			switch (model) {
				case "claude-code":
					// Claude Code uses OAuth token, not an API key — skip API validation
					break;
				case claudeSonnet46Model:
				case claudeOpus46Model:
				case claudeHaiku45Model:
					activeClaudeModel = true;
					break;
				case gemini2FlashStableModel:
				case gemini2FlashLiteModel:
				case gemini25ProModel:
				case gemini25FlashModel:
				case gemini25FlashLiteModel:
				case gemini3ProPreviewModel:
				case geminiFlashLatestModel:
				case geminiFlashLiteLatestModel:
					activeGeminiModel = true;
					break;
				case openAIModel:
					activeOpenAIModel = model === openAIModel;
					break;
			}
		});

		const providerKeyPairs = [
			{
				provider: openAI,
				key: this.settings.openAIAPIKey,
				isActive: activeOpenAIModel,
			},
			{
				provider: claude,
				key: this.settings.claudeAPIKey,
				isActive: activeClaudeModel,
			},
			{
				provider: gemini,
				key: this.settings.geminiAPIKey,
				isActive: activeGeminiModel,
			},
		];

		const filteredPairs = providerKeyPairs.filter(({ key, isActive }) => {
			// Skip providers with no keys -> this leaves us exposed to a user selecting a default model without adding a key.
			if (!key) return;
			// Only inspect pairs that are active in the application
			if (!isActive) return;
			return key;
		});

		const promises = filteredPairs.map(async (pair) => {
			const result = await getApiKeyValidity(pair);
			return result;
		});

		await Promise.all(promises);
	}

	async checkForAPIKeyBasedModel() {
		const isGeminiModel = (model: string) => [
			gemini2FlashStableModel,
			gemini2FlashLiteModel,
			gemini25ProModel,
			gemini25FlashModel,
			gemini25FlashLiteModel,
			gemini3ProPreviewModel,
			geminiFlashLatestModel,
			geminiFlashLiteLatestModel
		].includes(model);

		const isClaudeModel = (model: string) => [
			claudeSonnet46Model,
			claudeOpus46Model,
			claudeHaiku45Model,
		].includes(model);

		const fabModelRequiresKey =
			this.settings.fabSettings.model === openAIModel ||
			isClaudeModel(this.settings.fabSettings.model) ||
			this.settings.fabSettings.model === "claude-code" ||
			isGeminiModel(this.settings.fabSettings.model);

		const widgetModelRequresKey =
			this.settings.widgetSettings.model === openAIModel ||
			isClaudeModel(this.settings.widgetSettings.model) ||
			this.settings.widgetSettings.model === "claude-code" ||
			isGeminiModel(this.settings.widgetSettings.model);

		const modalModelRequresKey =
			this.settings.modalSettings.model === openAIModel ||
			isClaudeModel(this.settings.modalSettings.model) ||
			this.settings.modalSettings.model === "claude-code" ||
			isGeminiModel(this.settings.modalSettings.model);

		const activeModelRequiresKey =
			fabModelRequiresKey ||
			widgetModelRequresKey ||
			modalModelRequresKey;

		if (activeModelRequiresKey) await this.validateActiveModelsAPIKeys();
	}
	// end refactor into utils section
}
