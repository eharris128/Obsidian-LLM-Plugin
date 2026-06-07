import { Plugin, WorkspaceLeaf, Platform, addIcon, Notice } from "obsidian";
import {
	AssistantSettings,
	FeatureSettings,
	HistoryItem,
	ImageQuality,
	ImageSize,
	MemorySettings,
	ObsidianAgentSettings,
	ProjectSettings,
	RAGSettings,
	ResponseFormat,
	SearxngSettings,
	SkillsSettings,
	ToolSettings,
	ViewSettings,
	WhisperSettings,
} from "./Types/types";
import { WhisperService } from "./Whisper/WhisperService";
import { SidecarManager } from "./Whisper/SidecarManager";
import { SearxngService } from "./WebSearch/SearxngService";
import { ObsidianAgent } from "Plugin/ObsidianAgent/ObsidianAgent";
import { AssistantManager } from "Assistants/AssistantManager";
import { ProjectManager } from "Projects/ProjectManager";
import { MemoryService } from "Memory/MemoryService";
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
import { CHATS_VIEW_TYPE, ChatsView } from "Plugin/ChatsView/ChatsView";
import { CHAT_DETAILS_VIEW_TYPE, ChatDetailsView } from "Plugin/ChatDetailsView/ChatDetailsView";
import SettingsView from "Settings/SettingsView";
import { getApiKeyValidity } from "utils/utils";
import { models, modelNames, buildOllamaModels, buildLMStudioModels, openAIModelIds } from "utils/models";
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
	showAssistantLogo: boolean;
	showAgentBrandIcon: boolean;
	enableFileContext: boolean;
	defaultModel: string;
	defaultAgentMode: boolean;
	ollamaHost: string;
	ollamaModels: string[];
	ollamaContextWindows: Record<string, number>;
	lmStudioHost: string;
	lmStudioModels: string[];
	emptyChatAvatar: string;
	fabViewHeight?: number;
	showStatusBarButton: boolean;
	ragSettings: RAGSettings;
	skillsSettings: SkillsSettings;
	memorySettings: MemorySettings;
	projectSettings: ProjectSettings;
	assistantSettings: AssistantSettings;
	toolSettings: ToolSettings;
	obsidianAgentSettings: ObsidianAgentSettings;
	/** Whisper speech-to-text settings (voice input + file transcription). */
	whisperSettings: WhisperSettings;
	/** SearXNG web search settings. */
	searxngSettings: SearxngSettings;
	/**
	 * Root vault folder for all AI feature data (default "AI").
	 * Skills live at <rootVaultFolder>/Skills/<skill-name>/SKILL.md.
	 * Future features (Assistants, Projects, Memories, Chats) will also
	 * live under this root.
	 */
	rootVaultFolder: string;
	/**
	 * Master feature gates — each controls whether the corresponding feature tab
	 * appears in the settings sidebar and (for features with an `enabled` flag)
	 * whether that feature is active. All off by default so new users start with
	 * a clean, uncluttered experience.
	 */
	featureSettings: FeatureSettings;
	/**
	 * Vault-relative path to the general instructions file injected into every
	 * conversation (all models, assistants, and the Obsidian Agent).
	 * Defaults to "AI/AGENTS.md". Empty string = disabled.
	 */
	agentsFilePath: string;
	/** Set to true after the first-run Notice has been shown — prevents repeat on subsequent loads. */
	hasOnboarded: boolean;
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
		showModelLabel: false, // Show model/assistant name below each response
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
	chatHistoryEnabled: true,
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
	showAssistantLogo: true,
	showAgentBrandIcon: true,
	enableFileContext: false,
	defaultModel: "",
	defaultAgentMode: false,
	ollamaHost: "http://localhost:11434",
	ollamaModels: [],
	ollamaContextWindows: {},
	lmStudioHost: "http://localhost:1234",
	lmStudioModels: [],
	emptyChatAvatar: "llm-gal",
	showStatusBarButton: false,
	ragSettings: {
		enabled: false,
		embeddingProvider: "onnx" as const,
		embeddingModel: DEFAULT_EMBEDDING_MODELS["onnx"],
		excludedFolders: [],
		topK: 5,
		lastIndexed: null,
		indexedFileCount: 0,
		modelCached: false,
	},
	skillsSettings: {
		enabledSkills: {},
	},
	memorySettings: {
		enabled: false,
		extractionTrigger: "manual" as const,
		recallTopK: 5,
		recallAlways: false,
	},
	projectSettings: {
		activeProjectId: null,
	},
	assistantSettings: {
		activeAssistantId: null,
	},
	toolSettings: {
		disabledTools: [],
		maxToolCalls: 10,
	},
	obsidianAgentSettings: {
		enabled: false,
		enableWebSearch: false,
		availableSkills: {},
		availableAssistants: {},
		agentGuidanceFile: "",
	},
	whisperSettings: {
		enabled: false,
		backend: "openai" as const,
		sidecarHost: "http://localhost:8765",
		whisperModel: "medium.en",
		language: "",
		includeTimestamps: false,
		outputFolder: "Transcripts",
		autoOpenNote: true,
		autoSend: false,
		lastPickerDirectory: "",
	},
	searxngSettings: {
		enabled: false,
		host: "http://localhost:8080",
		maxResults: 5,
	},
	rootVaultFolder: "",
	agentsFilePath: "AI/AGENTS.md",
	hasOnboarded: false,
	featureSettings: {
		obsidianAgent: false,
		transcription: false,
		projects: false,
		assistants: false,
		memory: false,
		vaultSearch: false,
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
	/** Memory service — initialized after settings load, null if memory is disabled. */
	memoryService: MemoryService | null = null;
	/** Debounce timers keyed by file path — prevents hammering the embedding API on rapid saves. */
	private ragDebounceTimers: Map<string, number> = new Map();
	/** Skills registry — always initialized; folder is configurable in settings. */
	skillRegistry: SkillRegistry;
	/** Projects registry — always initialized; folder derived from rootVaultFolder. */
	projectManager: ProjectManager;
	/** Assistants registry — always initialized; folder derived from rootVaultFolder. */
	assistantManager: AssistantManager;
	/** Obsidian Agent — always initialized; active when obsidianAgentSettings.enabled is true. */
	obsidianAgent: ObsidianAgent;
	/** Whisper transcription service — null if whisperSettings.enabled is false. */
	whisperService: WhisperService | null = null;
	/** Manages the local Python sidecar server lifecycle and dependency detection. */
	sidecarManager: SidecarManager = new SidecarManager(this);
	/** SearXNG web search service — null if searxngSettings.enabled is false. */
	searxngService: SearxngService | null = null;
	/**
	 * The most recently focused widget leaf. Updated by the active-leaf-change event.
	 * Used to route "open chat file" and similar actions to the correct widget when
	 * multiple chat widget tabs are open simultaneously.
	 */
	lastFocusedWidgetLeaf: WorkspaceLeaf | null = null;

	async onload() {
		// Register custom icons that aren't in the Obsidian-bundled version of Lucide.
		// addIcon uses a 0 0 100 100 viewBox; scale the 24x24 Lucide paths up by 100/24 ≈ 4.1667.
		// Wrapping in a <g transform="scale(4.1667)"> is the simplest approach — stroke-width
		// scales proportionally to ~8.3pt which matches other sidebar icons at this size.
		addIcon(
			"stone",
			`<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			  <path d="M11.264 2.205A4 4 0 0 0 6.42 4.211l-4 8a4 4 0 0 0 1.359 5.117l6 4a4 4 0 0 0 4.438 0l6-4a4 4 0 0 0 1.576-4.592l-2-6a4 4 0 0 0-2.53-2.53z"/>
			  <path d="M11.99 22 14 12l7.822 3.184"/>
			  <path d="M14 12 8.47 2.302"/>
			</g>`
		);
		addIcon(
			"blocks",
			`<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			  <rect width="7" height="7" x="14" y="3" rx="1"/>
			  <path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"/>
			</g>`
		);

		this.fileSystem = Platform.isDesktop
			? new DesktopFileSystem()
			: new MobileFileSystem(this);
		this.os = Platform.isDesktop
			? new DesktopOperatingSystem()
			: new MobileOperatingSystem();
		await this.loadSettings();

		// Show a one-time welcome Notice on first load (new installs and upgraders alike).
		if (!this.settings.hasOnboarded) {
			new Notice(
				"👋 Large Language Models: your chats are saved as markdown files in your vault. " +
				"Open Settings → Large Language Models to add an API key and get started.",
				10000
			);
			this.settings.hasOnboarded = true;
			await this.saveSettings();
		}

		// Configure ONNX env before any pipeline call — sets cache dir to the
		// plugin's OS path so transformers.js uses Node.js https (not browser
		// fetch), bypassing Obsidian's Content Security Policy.
		const vaultBasePath = (this.app.vault.adapter as any).basePath;
		const pluginOsDir = require("path").join(vaultBasePath, this.manifest.dir);
		EmbeddingService.configure(pluginOsDir);

		this.initVaultIndexer();
		if (this.settings.ragSettings?.enabled && this.settings.ragSettings?.modelCached
				&& (this.settings.ragSettings?.embeddingProvider ?? "onnx") === "onnx") {
			EmbeddingService.loadOnnx().catch(e => console.error("[RAG] Failed to warm up ONNX model:", e));
		}
		this.initMemoryService();
		this.initWhisperService();
		this.initSearxngService();
		this.registerRagVaultEvents();
		this.skillRegistry = new SkillRegistry(this.app);
		this.projectManager = new ProjectManager(this.app);
		this.assistantManager = new AssistantManager(this.app);
		this.obsidianAgent = new ObsidianAgent(this);
		// Skills, Projects, and Assistants are in the vault — wait for layout ready before scanning.
		// Only initialise if the user has configured a root vault folder; otherwise these are no-ops
		// and no folders are created (consistent with Obsidian's own core plugin behaviour).
		this.app.workspace.onLayoutReady(async () => {
			if (this.settings.rootVaultFolder) {
				await this.skillRegistry.seedBuiltinSkills();
				await this.skillRegistry.setFolder(this.skillsFolder);
				await this.projectManager.setFolder(this.projectsFolder);
				await this.assistantManager.setFolder(this.assistantsFolder);
			}
			this.registerSkillVaultEvents();
			this.registerProjectVaultEvents();
			this.registerAssistantVaultEvents();
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
		this.registerView(CHATS_VIEW_TYPE, (leaf) => new ChatsView(leaf, this));
		this.registerView(CHAT_DETAILS_VIEW_TYPE, (leaf) => new ChatDetailsView(leaf, this));

		// Track which widget leaf the user most recently focused so that file-open
		// actions (from ChatsView, ChatsSidebar, file view-action buttons, etc.) are
		// routed to the correct widget when multiple widget tabs are open.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf && leaf.view instanceof WidgetView) {
					this.lastFocusedWidgetLeaf = leaf;
				}
			})
		);

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.fab = new FAB(this);
		this.statusBarButton = new StatusBarButton(this);
		this.recentChatsButton = new RecentChatsButton(this, this.statusBarButton);
		this.addSettingTab(new SettingsView(this.app, this, this.fab));
		if (this.settings.showFAB) {
			activeWindow.setTimeout(() => {
				this.fab.regenerateFAB();
			}, 500);
		}
		if (this.settings.showStatusBarButton) {
			activeWindow.setTimeout(() => {
				this.statusBarButton.generate();
				this.recentChatsButton.generate();
			}, 500);
		}
		this.history = new History(this);
		this.chatHistory = new ChatHistory(this);
		this.registerChatFileViewAction();
	}

	/**
	 * Register workspace events that add a persistent "Open in chat widget" action
	 * button to every open chat history file, regardless of which tab is active.
	 *
	 * Uses a per-leaf Map so buttons survive tab switches — the button is added
	 * once when the leaf shows a chat file and removed only when the leaf navigates
	 * away from it or is closed.
	 */
	private registerChatFileViewAction() {
		// leaf → { button element, file path it was created for }
		const leafButtons = new Map<WorkspaceLeaf, { el: HTMLElement; path: string }>();

		const isChatFilePath = (path: string): boolean => {
			const chatFolder = this.settings.chatHistoryFolder || "LLM Chats";
			return (
				path.startsWith(chatFolder + "/") ||
				(path.startsWith(this.projectsFolder + "/") && path.includes("/chats/"))
			);
		};

		const attachAll = () => {
			// 1. Iterate every open leaf; add/update buttons as needed.
			this.app.workspace.iterateAllLeaves((leaf) => {
				const view = leaf.view as any;
				const file = view?.file;
				const path = file?.extension === "md" ? (file.path as string) : null;

				const existing = leafButtons.get(leaf);

				// Nothing to do — same leaf, same file, button already present.
				if (existing && existing.path === path) return;

				// File changed or leaf no longer has a chat file — remove stale button.
				if (existing) {
					existing.el.remove();
					leafButtons.delete(leaf);
				}

				if (!path || !isChatFilePath(path)) return;
				if (typeof view.addAction !== "function") return;

				// Remove any stale button left in the DOM from a previous plugin load.
				// view.addAction() appends to a persistent view-header element that
				// survives hot-reloads; the leafButtons Map is fresh each load and
				// won't find the old element, so we must scrub it from the DOM first
				// or we'll end up with duplicate buttons.
				const stale = (view.containerEl as HTMLElement | undefined)
					?.querySelector?.(".llm-open-in-widget-action") as HTMLElement | null;
				stale?.remove();

				const btn: HTMLElement = view.addAction(
					"bot-message-square",
					"Open in chat widget",
					async () => {
						// Transform THIS leaf in-place into a chat widget.
						// The user clicked the button in a specific tab — the natural expectation
						// is that THAT tab becomes the chat widget, not some other open tab.
						await leaf.setViewState({ type: TAB_VIEW_TYPE, active: true });
						this.app.workspace.revealLeaf(leaf);
						// leaf.view is now a WidgetView; load the chat file directly.
						await (leaf.view as WidgetView).loadChatFile(path);
					}
				);
				btn.addClass("llm-open-in-widget-action");
				leafButtons.set(leaf, { el: btn, path });
			});

			// 2. Remove entries for leaves that are no longer open.
			for (const [leaf, { el }] of leafButtons) {
				let found = false;
				this.app.workspace.iterateAllLeaves((l) => { if (l === leaf) found = true; });
				if (!found) {
					el.remove();
					leafButtons.delete(leaf);
				}
			}
		};

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => attachAll())
		);

		this.registerEvent(
			this.app.workspace.on("layout-change", () => attachAll())
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

	/** Re-render the chip strip in every live chat view (e.g. after the AGENTS.md path changes). */
	refreshAllChips() {
		this.fab?.syncChips();
		this.statusBarButton?.syncChips();
		for (const leaf of this.app.workspace.getLeavesOfType(TAB_VIEW_TYPE)) {
			(leaf.view as WidgetView).syncChips();
		}
	}

	/** Show or hide the mic button in every live chat view (called after toggling Transcription). */
	refreshAllMicButtons() {
		this.fab?.syncMicButton();
		this.statusBarButton?.syncMicButton();
		for (const leaf of this.app.workspace.getLeavesOfType(TAB_VIEW_TYPE)) {
			(leaf.view as WidgetView).syncMicButton();
		}
	}

	/** Open a chat markdown file in the widget tab, creating the widget if needed. */
	async openChatFileInWidget(filePath: string): Promise<void> {
		const { workspace } = this.app;
		const tabs = workspace.getLeavesOfType(TAB_VIEW_TYPE);

		if (tabs.length > 0) {
			// Route to the best available widget:
			// 1. Last focused widget leaf (preferred — user's most recent context)
			// 2. Currently active leaf if it's a widget
			// 3. First widget leaf (fallback)
			let leaf: WorkspaceLeaf;
			if (this.lastFocusedWidgetLeaf && tabs.includes(this.lastFocusedWidgetLeaf)) {
				leaf = this.lastFocusedWidgetLeaf;
			} else {
				const activeLeaf = workspace.activeLeaf;
				leaf = (activeLeaf && activeLeaf.view instanceof WidgetView && tabs.includes(activeLeaf))
					? activeLeaf
					: tabs[0];
			}
			workspace.revealLeaf(leaf);
			await (leaf.view as WidgetView).loadChatFile(filePath);
		} else {
			// No widget open — set pending path and open a new tab; onOpen() will load it
			this.pendingWidgetFilePath = filePath;
			const leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: TAB_VIEW_TYPE, active: true });
			workspace.revealLeaf(leaf);
		}
	}

	/** Open (or reveal) the widget in the right sidebar with a specific chat file pre-loaded. */
	async openChatFileInSidebar(filePath: string): Promise<void> {
		this.pendingWidgetFilePath = filePath;
		await this.activateSidebar();
	}

	/** Open a chat file in the FAB popover. */
	openChatFileInFAB(filePath: string): void {
		this.fab.openAtHistoryFile(filePath);
	}

	/** Open a chat file in the status-bar popover ("Ask AI" button). */
	openChatFileInPopover(filePath: string): void {
		this.statusBarButton.openAtHistoryFile(filePath);
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
				if (existing) activeWindow.clearTimeout(existing);

				const timer = activeWindow.setTimeout(async () => {
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
					activeWindow.clearTimeout(timer);
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
			provider: rag.embeddingProvider ?? "onnx",
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
	 * Derived path to the Skills folder: "<rootVaultFolder>/Skills".
	 * All code that needs the skills folder path should use this getter.
	 */
	get skillsFolder(): string {
		return this.settings.rootVaultFolder
			? this.settings.rootVaultFolder + "/Skills"
			: "";
	}

	/**
	 * Derived path to the global Memories folder: "<rootVaultFolder>/Memories".
	 */
	get memoriesFolder(): string {
		return this.settings.rootVaultFolder
			? this.settings.rootVaultFolder + "/Memories"
			: "";
	}

	/**
	 * Derived path to the Projects folder: "<rootVaultFolder>/Projects".
	 */
	get projectsFolder(): string {
		return this.settings.rootVaultFolder
			? this.settings.rootVaultFolder + "/Projects"
			: "";
	}

	/**
	 * Derived path to the Assistants folder: "<rootVaultFolder>/Assistants".
	 */
	get assistantsFolder(): string {
		return this.settings.rootVaultFolder
			? this.settings.rootVaultFolder + "/Assistants"
			: "";
	}

	/**
	 * Re-initialise the ProjectManager from current settings.
	 * Call after the root vault folder setting changes.
	 */
	async reinitProjectManager(): Promise<void> {
		if (!this.settings.rootVaultFolder) return;
		await this.projectManager.setFolder(this.projectsFolder);
	}

	/**
	 * Re-initialise the AssistantManager from current settings.
	 * Call after the root vault folder setting changes.
	 */
	async reinitAssistantManager(): Promise<void> {
		if (!this.settings.rootVaultFolder) return;
		await this.assistantManager.setFolder(this.assistantsFolder);
	}

	/**
	 * Notify all live ChatContainer instances (FAB, status bar, and any open
	 * widget tabs) to rebuild their assistants optgroup. Call this after any
	 * change to the AssistantManager's loaded set.
	 */
	syncAllAssistantDropdowns(): void {
		this.fab?.syncAssistantDropdownOptions();
		this.statusBarButton?.syncAssistantDropdownOptions();
		for (const leaf of this.app.workspace.getLeavesOfType(TAB_VIEW_TYPE)) {
			(leaf.view as WidgetView).syncAssistantDropdownOptions();
		}
	}

	/**
	 * Re-sync the selected value in every live chat toolbar dropdown to reflect
	 * the current default model / active assistant. Call this after the General
	 * settings "Default model or assistant" picker changes.
	 */
	syncAllModelDropdowns(): void {
		this.fab?.syncModelDropdown();
		this.statusBarButton?.syncModelDropdown();
		for (const leaf of this.app.workspace.getLeavesOfType(TAB_VIEW_TYPE)) {
			(leaf.view as WidgetView).syncModelDropdown();
		}
	}

	/**
	 * Set agent mode on every live ChatContainer and sync their dropdowns.
	 * Call this after the General settings "Default model or assistant" picker
	 * changes to or from the Obsidian Agent option.
	 */
	syncAllContainersAgentMode(enabled: boolean): void {
		this.fab?.setAgentMode(enabled);
		this.statusBarButton?.setAgentMode(enabled);
		for (const leaf of this.app.workspace.getLeavesOfType(TAB_VIEW_TYPE)) {
			(leaf.view as WidgetView).setAgentMode(enabled);
		}
	}

	/**
	 * Register vault events to keep the ProjectManager hot-reloaded whenever
	 * PROJECT.md files inside the projects folder are created, modified, or deleted.
	 */
	private registerProjectVaultEvents(): void {
		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (this.projectManager.isProjectFile(file.path)) {
					await this.projectManager.loadProjectByPath(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (this.projectManager.isProjectFile(file.path)) {
					await this.projectManager.loadProjectByPath(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.projectManager.isProjectFile(file.path)) {
					this.projectManager.removeByPath(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				if (this.projectManager.isProjectFile(oldPath)) {
					this.projectManager.removeByPath(oldPath);
				}
				if (this.projectManager.isProjectFile(file.path)) {
					await this.projectManager.loadProjectByPath(file.path);
				}
			})
		);
	}

	/**
	 * Register vault events to keep the AssistantManager hot-reloaded whenever
	 * ASSISTANT.md files inside the assistants folder are created, modified, or deleted.
	 */
	private registerAssistantVaultEvents(): void {
		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (this.assistantManager.isAssistantFile(file.path)) {
					await this.assistantManager.loadAssistantByPath(file.path);
					this.syncAllAssistantDropdowns();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (this.assistantManager.isAssistantFile(file.path)) {
					await this.assistantManager.loadAssistantByPath(file.path);
					this.syncAllAssistantDropdowns();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (this.assistantManager.isAssistantFile(file.path)) {
					this.assistantManager.removeByPath(file.path);
					this.syncAllAssistantDropdowns();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("rename", async (file, oldPath) => {
				if (this.assistantManager.isAssistantFile(oldPath)) {
					this.assistantManager.removeByPath(oldPath);
				}
				if (this.assistantManager.isAssistantFile(file.path)) {
					await this.assistantManager.loadAssistantByPath(file.path);
				}
				this.syncAllAssistantDropdowns();
			})
		);
	}

	/**
	 * Build (or rebuild) the MemoryService from current settings.
	 * Safe to call after any settings change that affects memory or RAG configuration.
	 */
	initMemoryService(): void {
		const mem = this.settings.memorySettings;
		const rag = this.settings.ragSettings;
		if (!mem?.enabled || !rag?.enabled) {
			this.memoryService = null;
			return;
		}
		const embeddingService = new EmbeddingService({
			provider: rag.embeddingProvider ?? "onnx",
			model: rag.embeddingModel,
			openAIKey: this.settings.openAIAPIKey,
			geminiKey: this.settings.geminiAPIKey,
			ollamaHost: this.settings.ollamaHost,
			lmStudioHost: this.settings.lmStudioHost,
		});
		this.memoryService = new MemoryService(
			this.app,
			embeddingService,
			this.settings.rootVaultFolder || "AI",
		);
	}

	/**
	 * Initialise (or tear down) the WhisperService based on current settings.
	 * Safe to call after any settings change that affects whisper configuration.
	 */
	initWhisperService(): void {
		if (!this.settings.whisperSettings?.enabled) {
			this.whisperService = null;
			return;
		}
		this.whisperService = new WhisperService(this);
	}

	/**
	 * Initialise (or tear down) the SearxngService based on current settings.
	 * Safe to call after any settings change that affects SearXNG configuration.
	 */
	initSearxngService(): void {
		const s = this.settings.searxngSettings;
		if (!s?.enabled || !s.host?.trim()) {
			this.searxngService = null;
			return;
		}
		this.searxngService = new SearxngService(s.host.trim(), s.maxResults ?? 5);
	}

	/**
	 * Re-initialise the SkillRegistry from current settings.
	 * Call after the root vault folder setting changes.
	 */
	async reinitSkillRegistry(): Promise<void> {
		if (!this.settings.rootVaultFolder) return;
		await this.skillRegistry.seedBuiltinSkills();
		await this.skillRegistry.setFolder(this.skillsFolder);
	}

	/**
	 * Register vault events to keep the SkillRegistry hot-reloaded whenever
	 * SKILL.md files inside the skills folder are created, modified, or deleted.
	 */
	private registerSkillVaultEvents(): void {
		this.registerEvent(
			this.app.vault.on("create", async (file) => {
				if (this.skillRegistry.isSkillFile(file.path)) {
					await this.skillRegistry.loadSkillByPath(file.path);
				}
			})
		);

		this.registerEvent(
			this.app.vault.on("modify", async (file) => {
				if (this.skillRegistry.isSkillFile(file.path)) {
					await this.skillRegistry.loadSkillByPath(file.path);
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
				if (this.skillRegistry.isSkillFile(oldPath)) {
					this.skillRegistry.removeByPath(oldPath);
				}
				if (this.skillRegistry.isSkillFile(file.path)) {
					await this.skillRegistry.loadSkillByPath(file.path);
				}
			})
		);
	}

	onunload() {
		// Cancel any pending RAG debounce timers so they don't fire after the
		// plugin is torn down and try to write to a null vaultIndexer.
		for (const timer of this.ragDebounceTimers.values()) {
			activeWindow.clearTimeout(timer);
		}
		this.ragDebounceTimers.clear();

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
			id: "new-chat-widget",
			name: "New chat widget",
			callback: async () => {
				const leaf = this.app.workspace.getLeaf("tab");
				await leaf.setViewState({ type: TAB_VIEW_TYPE, active: true });
				this.app.workspace.revealLeaf(leaf);
			},
		});

		this.addCommand({
			id: "toggle-LLM-fab",
			name: "Toggle FAB",
			callback: () => {
				const currentFABState = this.settings.showFAB;
				this.settings.showFAB = !currentFABState;
				void this.saveSettings();
				this.settings.showFAB
					? this.fab.regenerateFAB()
					: this.fab.removeFab();
			},
		});

		this.addCommand({
			id: "open-obsidian-agent",
			name: "Open Obsidian Agent",
			callback: () => {
				if (!this.settings.featureSettings?.obsidianAgent) {
					new Notice("Enable the Obsidian Agent feature in Settings → Large Language Models → General first.");
					return;
				}
				new ChatModal2(this, true).open();
			},
		});

		this.addCommand({
			id: "open-chats-panel",
			name: "Open Chats panel",
			callback: () => {
				void this.activateChatsPanel();
			},
		});

		this.addCommand({
			id: "open-chat-details-panel",
			name: "Open Chat Details panel",
			callback: () => {
				void this.activateChatDetailsPanel();
			},
		});

		// ── Whisper commands ──────────────────────────────────────────────────
		this.addCommand({
			id: "transcribe-audio-file",
			name: "Transcribe audio file",
			callback: async () => {
				if (!this.settings.whisperSettings?.enabled) {
					const { Notice } = await import("obsidian");
					new Notice("Enable Whisper in Settings → Transcription first.");
					return;
				}
				const { transcribeAudioFile } = await import("./Whisper/TranscribeCommand");
				await transcribeAudioFile(this);
			},
		});
	}

	private registerOllamaModels() {
		if (this.settings.ollamaModels.length > 0) {
			const built = buildOllamaModels(
				this.settings.ollamaModels,
				this.settings.ollamaContextWindows ?? {}
			);
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
			this.ribbonIconEl = this.addRibbonIcon("bot", "Ask a question", (_evt: MouseEvent) => {
				new ChatModal2(this).open();
			});
		}
	}

	/**
	 * Open (or reveal) the Chat Details panel in the right sidebar.
	 * If already open, simply bring it into focus.
	 */
	async activateChatDetailsPanel() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(CHAT_DETAILS_VIEW_TYPE);

		if (leaves.length > 0) {
			workspace.revealLeaf(leaves[0]);
			(leaves[0].view as ChatDetailsView).refreshFromPlugin();
			return;
		}

		const leaf = workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: CHAT_DETAILS_VIEW_TYPE, active: true });
		workspace.revealLeaf(leaf);
	}

	/**
	 * Toggle the right sidebar open/closed, ensuring the Chat Details panel is
	 * loaded into it when opening.
	 * - Collapsed → ensure Chat Details leaf exists, then expand the sidebar.
	 * - Expanded  → collapse the sidebar.
	 * Returns true when the sidebar was opened, false when collapsed.
	 */
	async toggleChatDetailsPanel(): Promise<boolean> {
		const { workspace } = this.app;
		const rightSplit = (workspace as any).rightSplit;

		const isCollapsed: boolean = rightSplit?.collapsed ?? false;

		if (isCollapsed) {
			// Ensure Chat Details leaf exists before expanding
			const leaves = workspace.getLeavesOfType(CHAT_DETAILS_VIEW_TYPE);
			if (leaves.length === 0) {
				const leaf = workspace.getRightLeaf(false);
				if (leaf) {
					await leaf.setViewState({ type: CHAT_DETAILS_VIEW_TYPE, active: true });
				}
			}
			rightSplit?.expand();
			// Bring the Chat Details tab to front in case other panels are also open
			const detailsLeaves = workspace.getLeavesOfType(CHAT_DETAILS_VIEW_TYPE);
			if (detailsLeaves.length > 0) {
				workspace.revealLeaf(detailsLeaves[0]);
				(detailsLeaves[0].view as ChatDetailsView).refreshFromPlugin();
			}
			return true;
		} else {
			rightSplit?.collapse();
			return false;
		}
	}

	/**
	 * Return the open ChatDetailsView instance, or null if the panel is closed.
	 * Used by ChatContainer to push live state updates.
	 */
	getChatDetailsView(): ChatDetailsView | null {
		const leaves = this.app.workspace.getLeavesOfType(CHAT_DETAILS_VIEW_TYPE);
		return leaves.length > 0 ? (leaves[0].view as ChatDetailsView) : null;
	}

	/**
	 * Open (or reveal) the Chats panel in the right sidebar.
	 * If it's already open, simply bring it into focus.
	 */
	async activateChatsPanel() {
		const { workspace } = this.app;
		const leaves = workspace.getLeavesOfType(CHATS_VIEW_TYPE);

		if (leaves.length > 0) {
			workspace.revealLeaf(leaves[0]);
			const view = leaves[0].view as ChatsView;
			await view.refresh();
			return;
		}

		const leaf = workspace.getLeftLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: CHATS_VIEW_TYPE, active: true });
		workspace.revealLeaf(leaf);
	}

	async activateTab() {
		const { workspace } = this.app;
		const pendingIndex = this.pendingWidgetHistoryIndex;
		const pendingFilePath = this.pendingWidgetFilePath;

		let tab: WorkspaceLeaf;
		const tabs = workspace.getLeavesOfType(TAB_VIEW_TYPE);

		if (tabs.length > 0) {
			// Prefer the last focused widget leaf; fall back to the first available.
			tab = (this.lastFocusedWidgetLeaf && tabs.includes(this.lastFocusedWidgetLeaf))
				? this.lastFocusedWidgetLeaf
				: tabs[0];
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

			// Deep-merge skillsSettings (folder field removed — path now derived from rootVaultFolder)
			this.settings.skillsSettings = {
				...DEFAULT_SETTINGS.skillsSettings,
				enabledSkills: {
					...DEFAULT_SETTINGS.skillsSettings.enabledSkills,
					...(dataJSON.skillsSettings?.enabledSkills ?? {}),
				},
			};

			// Migrate old skillsSettings.folder → rootVaultFolder.
			// The old system stored the skills folder path directly (e.g. "LLM-Skills" or "AI/Skills").
			// The new system derives it from rootVaultFolder as "<root>/Skills".
			const oldSkillsFolder: string | undefined = (dataJSON.skillsSettings)?.folder;
			if (oldSkillsFolder && !this.settings.rootVaultFolder) {
				if (oldSkillsFolder.endsWith("/Skills")) {
					// e.g. "AI/Skills" → rootVaultFolder = "AI"
					this.settings.rootVaultFolder = oldSkillsFolder.slice(0, -"/Skills".length);
					await this.saveSettings();
				} else {
					// e.g. old default "LLM-Skills" — can't infer root safely; warn the user.
					new Notice(
						`⚠️ Skills location has changed. Your skills were in '${oldSkillsFolder}/'. ` +
						`Please move them into '[Root vault folder]/Skills/' and set 'Root vault folder' ` +
						`in Settings → Large Language Models → General.`,
						0 // stay until dismissed
					);
				}
			}

			// Deep-merge memorySettings so new fields get defaults if missing from saved data
			this.settings.memorySettings = {
				...DEFAULT_SETTINGS.memorySettings,
				...(dataJSON.memorySettings ?? {}),
			};

			// Deep-merge projectSettings so new fields get defaults if missing from saved data
			this.settings.projectSettings = {
				...DEFAULT_SETTINGS.projectSettings,
				...(dataJSON.projectSettings ?? {}),
			};

			// Deep-merge assistantSettings so new fields get defaults if missing from saved data
			this.settings.assistantSettings = {
				...DEFAULT_SETTINGS.assistantSettings,
				...(dataJSON.assistantSettings ?? {}),
			};

			// Deep-merge whisperSettings so new fields get defaults if missing from saved data
			this.settings.whisperSettings = {
				...DEFAULT_SETTINGS.whisperSettings,
				...(dataJSON.whisperSettings ?? {}),
			};

			// Deep-merge searxngSettings so new fields get defaults if missing from saved data
			this.settings.searxngSettings = {
				...DEFAULT_SETTINGS.searxngSettings,
				...(dataJSON.searxngSettings ?? {}),
			};

			// Deep-merge featureSettings so new gates default to false if absent from saved data
			this.settings.featureSettings = {
				...DEFAULT_SETTINGS.featureSettings,
				...(dataJSON.featureSettings ?? {}),
			};

			// Deep-merge toolSettings so new fields get defaults if missing from saved data
			this.settings.toolSettings = {
				...DEFAULT_SETTINGS.toolSettings,
				...(dataJSON.toolSettings ?? {}),
			};

			// Deep-merge obsidianAgentSettings — nested Records need spread so new keys get defaults
			this.settings.obsidianAgentSettings = {
				...DEFAULT_SETTINGS.obsidianAgentSettings,
				...(dataJSON.obsidianAgentSettings ?? {}),
				availableSkills: {
					...DEFAULT_SETTINGS.obsidianAgentSettings.availableSkills,
					...(dataJSON.obsidianAgentSettings?.availableSkills ?? {}),
				},
				availableAssistants: {
					...DEFAULT_SETTINGS.obsidianAgentSettings.availableAssistants,
					...(dataJSON.obsidianAgentSettings?.availableAssistants ?? {}),
				},
			};

			// Ensure rootVaultFolder is a string (new field — may be absent in old saves)
			if (this.settings.rootVaultFolder === undefined || this.settings.rootVaultFolder === null) {
				this.settings.rootVaultFolder = DEFAULT_SETTINGS.rootVaultFolder;
			}

			// Ensure emptyChatAvatar is a valid known value; fall back to default
			// if the saved value is missing or was corrupted (e.g. from a partial write).
			const validAvatars = ["llm-gal", "llm-guy", "zen-kid", "ninja-cat"];
			if (!validAvatars.includes(this.settings.emptyChatAvatar)) {
				this.settings.emptyChatAvatar = DEFAULT_SETTINGS.emptyChatAvatar;
			}

			// Migrate linearApiKey → linearWorkspaces
			if (dataJSON.linearApiKey && !dataJSON.linearWorkspaces) {
				this.settings.linearWorkspaces = [
					{ name: "Linear", apiKey: dataJSON.linearApiKey },
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
			if (model === "claude-code") {
				// Claude Code uses OAuth token, not an API key — skip API validation
			} else if (model === claudeSonnet46Model || model === claudeOpus46Model || model === claudeHaiku45Model) {
				activeClaudeModel = true;
			} else if ([
				gemini2FlashStableModel, gemini2FlashLiteModel, gemini25ProModel,
				gemini25FlashModel, gemini25FlashLiteModel, gemini3ProPreviewModel,
				geminiFlashLatestModel, geminiFlashLiteLatestModel,
			].includes(model)) {
				activeGeminiModel = true;
			} else if (openAIModelIds.has(model)) {
				activeOpenAIModel = true;
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
			openAIModelIds.has(this.settings.fabSettings.model) ||
			isClaudeModel(this.settings.fabSettings.model) ||
			this.settings.fabSettings.model === "claude-code" ||
			isGeminiModel(this.settings.fabSettings.model);

		const widgetModelRequresKey =
			openAIModelIds.has(this.settings.widgetSettings.model) ||
			isClaudeModel(this.settings.widgetSettings.model) ||
			this.settings.widgetSettings.model === "claude-code" ||
			isGeminiModel(this.settings.widgetSettings.model);

		const modalModelRequresKey =
			openAIModelIds.has(this.settings.modalSettings.model) ||
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
