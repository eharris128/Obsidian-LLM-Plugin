import { Assistant } from "openai/resources/beta/assistants";
import { assistant } from "utils/constants";

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
	tokens: number;
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
	style: "vivid" | "natural";
	quality?: "hd" | "standard";
};

export type AIAssistant = Assistant & {
	modelType: string;
};
export type AssistantParams = InitialParams;

export type AssistantHistoryItem = InitialParams & {
	assistant_id: string;
	modelName: string;
};
export type ChatHistoryItem = InitialParams &
	ChatParams & {
		modelName: string;
		vaultContext?: VaultContext;
	};

export type ProviderKeyPair = {
	provider: string;
	key: string;
};

export type ImageHistoryItem = InitialParams &
	ImageParams & {
		modelName: string;
	};

export type HistoryItem =
	| ChatHistoryItem
	| ImageHistoryItem
	| AssistantHistoryItem;

export type TokenParams = {
	prefix: string[];
	postfix: string[];
};

export type Message = {
	role: "user" | typeof assistant;
	content: string;
};

export type Model = {
	model: string;
	type: string;
	endpoint: string;
	url: string;
};

export type ViewType = "modal" | "widget" | "floating-action-button";

export type ViewSettings = {
	assistant: boolean;
	assistantId: string
	model: string;
	modelName: string;
	modelType: string;
	modelEndpoint: string;
	endpointURL: string;
	historyIndex: number;
	imageSettings: ImageSettings;
	chatSettings: ChatSettings;
	contextSettings: ContextSettings;
};

export type ResponseFormat = "url" | "b64_json";
export type ImageStyle = "vivid" | "natural";
export type ImageQuality = "hd" | "standard";
export type ImageSize =
	| "256x256"
	| "512x512"
	| "1024x1024"
	| "1024x1024"
	| "1792x1024"
	| "1024x1792";

type ImageSettings = {
	numberOfImages: number;
	response_format: ResponseFormat;
	size: ImageSize;
	style: ImageStyle;
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
