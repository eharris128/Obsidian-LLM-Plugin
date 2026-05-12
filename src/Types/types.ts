import { assistant } from "utils/constants";
import { EmbeddingProvider } from "RAG/EmbeddingService";

export type ContextSettings = {
	includeActiveFile: boolean;
	includeSelection: boolean;
	selectedFiles: string[]; // Array of file paths
	maxContextTokensPercent: number; // Percentage of maxTokens to use for context (0-100)
};

export type VaultContext = {
	activeFile?: {
		path: string;
		name: string;
		content: string;
	};
	selectedText?: string;
	additionalFiles: {
		path: string;
		name: string;
		content: string;
	}[];
};

type InitialParams = {
	prompt: string;
	messages: Message[];
	model: string;
};

export type ChatParams = InitialParams & {
	temperature: number;
	tokens?: number;
	systemContext?: string;
	frequencyPenalty?: number | null;
	logProbs?: boolean | null;
	topLogProbs?: number | null;
	presencePenalty?: number | null;
	responseFormat?: string | null;
	topP?: number | null;
};

export type ImageParams = InitialParams & {
	numberOfImages: number;
	response_format: "url" | "b64_json";
	size: string;
	quality?: "low" | "medium" | "high";
};

export type ChatHistoryItem = InitialParams &
	ChatParams & {
		id?: string;
		modelName: string;
		vaultContext?: VaultContext;
	};

export type ProviderKeyPair = {
	provider: string;
	key: string;
};

export type ImageHistoryItem = InitialParams &
	ImageParams & {
		id?: string;
		modelName: string;
	};

export type HistoryItem =
	| ChatHistoryItem
	| ImageHistoryItem;

export type TokenParams = {
	prefix: string[];
	postfix: string[];
};

export type Message = {
	role: "user" | "system" | typeof assistant;
	content: string;
};

export type Model = {
	model: string;
	type: string;
	endpoint: string;
	url: string;
};

export type ViewType = "modal" | "widget" | "floating-action-button";

/** Controls when the agent asks for permission before executing a tool. */
export type PermissionMode =
	| "ask"           // Auto-approve safe (read-only) tools; ask for write/danger
	| "auto-approve"  // Never ask — execute all tools automatically
	| "ask-everything"// Always ask, even for read-only tools
	| "read-only";    // Only allow safe tools; silently deny write/danger

/** Risk level assigned to each tool in ObsidianToolRegistry. */
export type RiskTier = "safe" | "write" | "danger";

/** A single tool call made by the agent during a conversation turn. */
export type ToolCallRecord = {
	name: string;
	input: Record<string, any>;
	result?: string;
};

export type AgentSettings = {
	permissionMode: PermissionMode;
};

export type ViewSettings = {
	model: string;
	modelName: string;
	modelType: string;
	modelEndpoint: string;
	endpointURL: string;
	historyIndex: number;
	/** File path of the currently open chat file (used when chatHistoryEnabled). */
	historyFilePath: string | null;
	imageSettings: ImageSettings;
	chatSettings: ChatSettings;
	contextSettings: ContextSettings;
	agentSettings: AgentSettings;
};

export type ResponseFormat = "url" | "b64_json";
export type ImageQuality = "low" | "medium" | "high";
export type ImageSize =
	| "1024x1024"
	| "1536x1024"
	| "1024x1536"
	| "auto";

type ImageSettings = {
	numberOfImages: number;
	response_format: ResponseFormat;
	size: ImageSize;
	quality: ImageQuality;
};

type ChatSettings = {
	maxTokens: number;
	temperature: number;
	GPT4All?: GPT4AllSettings;
	openAI?: OpenAISettings;
	gemini?: GeminiSettings;
};

type OpenAISettings = {
	frequencyPenalty: number;
	logProbs: boolean;
	topLogProbs: number | null;
	presencePenalty: number;
	responseFormat: string;
	topP: number;
};

type GeminiSettings = {
	topP: number;
}

type GPT4AllSettings = {};

export type SkillsSettings = {
	/**
	 * Per-skill enabled state keyed by skill id (folder name).
	 * When true the skill's instructions are injected for every message in all views.
	 * The skills folder is derived from LLMPluginSettings.rootVaultFolder: "<root>/Skills".
	 */
	enabledSkills: Record<string, boolean>;
};

export type MemorySettings = {
	/** Whether the memory feature is enabled at all. */
	enabled: boolean;
	/**
	 * When to run memory extraction:
	 * - "end-of-chat": automatically after newChat() or view close
	 * - "manual": only when user clicks "Extract memories now"
	 */
	extractionTrigger: "end-of-chat" | "manual";
	/** How many recalled memory chunks to inject as system context before each send. */
	recallTopK: number;
	/**
	 * When true, memory recall is active by default in every new conversation
	 * (equivalent to the brain button starting as enabled).
	 * When false (default), the user must toggle recall on per-conversation.
	 */
	recallAlways: boolean;
};

export type Project = {
	/** Unique key derived from the folder name. */
	id: string;
	/** Display name from frontmatter `name:`, or falls back to id. */
	name: string;
	/** One-line description from frontmatter `description:`. */
	description: string;
	/** Vault-relative paths to notes injected as context for every conversation. */
	pinnedNotes: string[];
	/** Optional default assistant name (for future Assistants feature). */
	defaultAssistant?: string;
	/** ISO date from frontmatter `created:`. */
	created: string;
	/** Vault path of the PROJECT.md file. */
	filePath: string;
	/** The system instructions body (everything below the --- frontmatter block). */
	instructions: string;
};

export type ProjectSettings = {
	/** The id of the currently active project, or null for "No project". */
	activeProjectId: string | null;
};

export type Assistant = {
	/** Unique key derived from the folder name. */
	id: string;
	/** Display name from frontmatter `name:`, or falls back to id. */
	name: string;
	/** One-line description from frontmatter `description:`. */
	description: string;
	/** Provider hint from frontmatter `provider:` (informational). */
	provider: string;
	/** Model hint from frontmatter `model:` (informational). */
	model: string;
	/** Skill ids from `enabled-skills:` — activated when this assistant is active. */
	enabledSkills: string[];
	/** Tool names from `allowed-tools:` — restricts the tool registry when active. Empty = all tools. */
	allowedTools: string[];
	/** ISO date from frontmatter `created:`. */
	created: string;
	/** Vault path of the ASSISTANT.md file. */
	filePath: string;
	/** The system prompt body (everything below the --- frontmatter block). */
	systemPrompt: string;
};

export type AssistantSettings = {
	/** The id of the currently active assistant, or null for none. */
	activeAssistantId: string | null;
};

export type ObsidianAgentSettings = {
	/** Whether the Obsidian Agent is enabled. When true, FAB and status bar open in agent mode. */
	enabled: boolean;
	/** Whether to enable web search (placeholder — for when providers support it). */
	enableWebSearch: boolean;
	/**
	 * Per-skill availability keyed by skill id.
	 * Explicitly false = excluded from the agent. Missing = available (default true).
	 */
	availableSkills: Record<string, boolean>;
	/**
	 * Per-assistant availability keyed by assistant id.
	 * Explicitly false = excluded. Missing = available (default true).
	 */
	availableAssistants: Record<string, boolean>;
	/** Free-text instructions appended after the agent's auto-generated base prompt. */
	vaultGuidance: string;
};

export type ToolSettings = {
	/**
	 * Tool names that are permanently disabled and will never be offered to the
	 * model, regardless of permission mode or active skill.
	 */
	disabledTools: string[];
	/**
	 * Maximum number of tool-call/execute cycles per agent turn before the loop
	 * is forced to stop. Prevents runaway agents.
	 */
	maxToolCalls: number;
};

export type RAGSettings = {
	/** Whether RAG / vault semantic search is enabled at all. */
	enabled: boolean;
	/** Which provider to use for generating embeddings. */
	embeddingProvider: EmbeddingProvider;
	/** Model name for the chosen provider (e.g. "text-embedding-3-small"). */
	embeddingModel: string;
	/** Vault-root-relative folder paths to skip during indexing (e.g. "Templates"). */
	excludedFolders: string[];
	/** How many chunks to retrieve per query. */
	topK: number;
	/** Unix timestamp (ms) of the last completed index run, or null if never run. */
	lastIndexed: number | null;
	/** Number of files in the current index. */
	indexedFileCount: number;
};
