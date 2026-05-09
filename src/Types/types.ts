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
	/** Vault-root-relative folder where skill sub-folders live (e.g. "LLM-Skills"). */
	folder: string;
	/**
	 * Per-skill enabled state keyed by skill id (folder name).
	 * When true the skill's instructions are injected for every message in all views.
	 */
	enabledSkills: Record<string, boolean>;
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
