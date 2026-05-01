import { Plugin, WorkspaceLeaf, Platform } from "obsidian";
import {
	HistoryItem,
	ImageQuality,
	ImageSize,
	ResponseFormat,
	ViewSettings,
} from "./Types/types";

import { History } from "History/HistoryHandler";
import { FAB } from "Plugin/FAB/FAB";
import { StatusBarButton } from "Plugin/StatusBar/StatusBarButton";
import { RecentChatsButton } from "Plugin/StatusBar/RecentChatsButton";
import { ChatModal2 } from "Plugin/Modal/ChatModal2";
import { TAB_VIEW_TYPE, WidgetView } from "Plugin/Widget/Widget";
import SettingsView from "Settings/SettingsView";
import { getApiKeyValidity } from "utils/utils";
import { models, modelNames, buildOllamaModels } from "utils/models";
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
	emptyChatAvatar: string;
	fabViewHeight?: number;
	showStatusBarButton: boolean;
}

const defaultSettings = {
	model: "gpt-3.5-turbo",
	modelName: "ChatGPT-3.5 turbo",
	modelType: "openAI",
	modelEndpoint: chat,
	endpointURL: "/chat/completions",
	historyIndex: -1,
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
	emptyChatAvatar: "llm-gal",
	showStatusBarButton: false,
};

export default class LLMPlugin extends Plugin {
	fileSystem: FileSystem;
	os: OperatingSystem;
	settings: LLMPluginSettings;
	history: History;
	fab: FAB;
	conversationRegistry: ConversationRegistry;
	ribbonIconEl: HTMLElement | null = null;
	statusBarButton: StatusBarButton;
	recentChatsButton: RecentChatsButton;
	/** Transient — set before opening the widget so it can auto-load the right conversation. */
	pendingWidgetHistoryIndex: number = -1;

	async onload() {
		this.fileSystem = Platform.isDesktop
			? new DesktopFileSystem()
			: new MobileFileSystem(this);
		this.os = Platform.isDesktop
			? new DesktopOperatingSystem()
			: new MobileOperatingSystem();
		await this.loadSettings();
		this.registerOllamaModels();
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

		let tab: WorkspaceLeaf | null = null;
		const tabs = workspace.getLeavesOfType(TAB_VIEW_TYPE);

		if (tabs.length > 0) {
			tab = tabs[0];
			// View already exists — load conversation directly if one is pending.
			if (pendingIndex >= 0) {
				this.pendingWidgetHistoryIndex = -1;
				(tab.view as WidgetView).loadConversation(pendingIndex);
			}
		} else {
			tab = workspace.getLeaf("tab");
			await tab.setViewState({ type: TAB_VIEW_TYPE, active: true });
			// onOpen will handle auto-loading via pendingWidgetHistoryIndex.
		}
		workspace.revealLeaf(tab);
	}

	async activateSidebar() {
		const { workspace } = this.app;
		const pendingIndex = this.pendingWidgetHistoryIndex;

		// Look for an existing widget leaf in the right sidebar.
		const leaves = workspace.getLeavesOfType(TAB_VIEW_TYPE);
		const sidebarLeaf = leaves.find(
			(l) => l.getRoot() === workspace.rightSplit
		);

		let leaf: WorkspaceLeaf;
		if (sidebarLeaf) {
			leaf = sidebarLeaf;
			// View already exists — load conversation directly if one is pending.
			if (pendingIndex >= 0) {
				this.pendingWidgetHistoryIndex = -1;
				(leaf.view as WidgetView).loadConversation(pendingIndex);
			}
		} else {
			leaf = workspace.getRightLeaf(false)!;
			await leaf.setViewState({ type: TAB_VIEW_TYPE, active: true });
			// onOpen will handle auto-loading via pendingWidgetHistoryIndex.
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
