import { Model } from "Types/types";
import { claude, claudeCode, claudeCodeEndpoint, chat, gemini, gemini2FlashStableModel, gemini2FlashLiteModel, gemini25ProModel, gemini25FlashModel, gemini25FlashLiteModel, gemini3ProPreviewModel, geminiFlashLatestModel, geminiFlashLiteLatestModel, GPT4All, images, messages, ollama, lmStudio, mistral, claudeSonnet46Model, claudeOpus46Model, claudeHaiku45Model } from "utils/constants"

export const openAIModels: Record<string, Model> = {
	"ChatGPT-3.5 turbo": {
		model: "gpt-3.5-turbo",
		type: "openAI",
		endpoint: chat,
		url: "/chat/completions",
		contextWindow: 16_385,
	},
	"GPT-4o": {
		model: "gpt-4o",
		type: "openAI",
		endpoint: chat,
		url: "/chat/completions",
		contextWindow: 128_000,
	},
	"GPT-4o-mini": {
		model: "gpt-4o-mini",
		type: "openAI",
		endpoint: chat,
		url: "/chat/completions",
		contextWindow: 128_000,
	},
	"GPT-4.1": {
		model: "gpt-4.1",
		type: "openAI",
		endpoint: chat,
		url: "/chat/completions",
		contextWindow: 1_047_576,
	},
	"GPT-4.1-mini": {
		model: "gpt-4.1-mini",
		type: "openAI",
		endpoint: chat,
		url: "/chat/completions",
		contextWindow: 1_047_576,
	},
	"GPT-4.1-nano": {
		model: "gpt-4.1-nano",
		type: "openAI",
		endpoint: chat,
		url: "/chat/completions",
		contextWindow: 1_047_576,
	},
	"o3": {
		model: "o3",
		type: "openAI",
		endpoint: chat,
		url: "/chat/completions",
		contextWindow: 200_000,
	},
	"o3-mini": {
		model: "o3-mini",
		type: "openAI",
		endpoint: chat,
		url: "/chat/completions",
		contextWindow: 200_000,
	},
	"o4-mini": {
		model: "o4-mini",
		type: "openAI",
		endpoint: chat,
		url: "/chat/completions",
		contextWindow: 200_000,
	},
}

export const models: Record<string, Model> = {
	...openAIModels,
	"ChatGPT-3.5 turbo GPT4All": {
		model: "gpt4all-gpt-3.5-turbo.rmodel",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	"Mistral OpenOrca": {
		model: "mistral-7b-openorca.Q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	"Mistral Instruct": {
		model: "mistral-7b-instruct-v0.1.Q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	"GPT4All Falcon": {
		model: "gpt4all-falcon-newbpe-q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	"Orca 2 (Medium)": {
		model: "orca-2-7b.Q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	"Orca 2 (Full)": {
		model: "orca-2-13b.Q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	"Mini Orca (Small)": {
		model: "orca-mini-3b-gguf2-q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	"MPT Chat": {
		model: "mpt-7b-chat-newbpe-q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	"Wizard v1.2": {
		model: "wizardlm-13b-v1.2.Q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	"Hermes 13B": {
		model: "nous-hermes-llama2-13b.Q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	"Hermes 7B": {
		model: "Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	Snoozy: {
		model: "gpt4all-13b-snoozy-q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	"EM German Mistral": {
		model: "em_german_mistral_v01.Q4_0.gguf",
		type: GPT4All,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 8_192,
	},
	// Claude Models
	"Claude Sonnet 4.6": {
		model: claudeSonnet46Model,
		type: claude,
		endpoint: messages,
		url: "/v1/messages",
		contextWindow: 200_000,
	},
	"Claude Opus 4.6": {
		model: claudeOpus46Model,
		type: claude,
		endpoint: messages,
		url: "/v1/messages",
		contextWindow: 200_000,
	},
	"Claude Haiku 4.5": {
		model: claudeHaiku45Model,
		type: claude,
		endpoint: messages,
		url: "/v1/messages",
		contextWindow: 200_000,
	},
	// Gemini Models
	"Gemini-3-Pro-Preview": {
		model: gemini3ProPreviewModel,
		type: gemini,
		endpoint: "gemini",
		url: "gemini",
		contextWindow: 1_048_576,
	},
	"Gemini-2.5-Pro": {
		model: gemini25ProModel,
		type: gemini,
		endpoint: "gemini",
		url: "gemini",
		contextWindow: 1_048_576,
	},
	"Gemini-Flash-Latest": {
		model: geminiFlashLatestModel,
		type: gemini,
		endpoint: "gemini",
		url: "gemini",
		contextWindow: 1_048_576,
	},
	"Gemini-Flash-Lite-Latest": {
		model: geminiFlashLiteLatestModel,
		type: gemini,
		endpoint: "gemini",
		url: "gemini",
		contextWindow: 1_048_576,
	},
	"Gemini-2.5-Flash": {
		model: gemini25FlashModel,
		type: gemini,
		endpoint: "gemini",
		url: "gemini",
		contextWindow: 1_048_576,
	},
	"Gemini-2.5-Flash-Lite": {
		model: gemini25FlashLiteModel,
		type: gemini,
		endpoint: "gemini",
		url: "gemini",
		contextWindow: 1_048_576,
	},
	"Gemini-2.0-Flash": {
		model: gemini2FlashStableModel,
		type: gemini,
		endpoint: "gemini",
		url: "gemini",
		contextWindow: 1_048_576,
	},
	"Gemini-2.0-Flash-Lite": {
		model: gemini2FlashLiteModel,
		type: gemini,
		endpoint: "gemini",
		url: "gemini",
		contextWindow: 1_048_576,
	},
	// Claude Code (Agent SDK)
	"Claude Code": {
		model: "claude-code",
		type: claudeCode,
		endpoint: claudeCodeEndpoint,
		url: "",
		contextWindow: 200_000,
	},
	"GPT Image 1": {
		model: "gpt-image-1",
		type: "openAI",
		endpoint: images,
		url: "/images/generations",
	},
	// Mistral AI Models
	"Mistral Large": {
		model: "mistral-large-latest",
		type: mistral,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 131_072,
	},
	"Mistral Medium": {
		model: "mistral-medium-latest",
		type: mistral,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 131_072,
	},
	"Mistral Small": {
		model: "mistral-small-latest",
		type: mistral,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 131_072,
	},
	"Mistral Nemo": {
		model: "mistral-nemo-12b-24-07",
		type: mistral,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 131_072,
	},
	"Magistral Medium": {
		model: "magistral-medium-latest",
		type: mistral,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 131_072,
	},
	"Magistral Small": {
		model: "magistral-small-latest",
		type: mistral,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 131_072,
	},
	"Devstral Small": {
		model: "devstral-small-latest",
		type: mistral,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 131_072,
	},
	"Codestral": {
		model: "codestral-latest",
		type: mistral,
		endpoint: chat,
		url: "/v1/chat/completions",
		contextWindow: 131_072,
	},
};

export const modelNames: Record<string, string> = {
	"mistral-7b-openorca.Q4_0.gguf": "Mistral OpenOrca",
	"mistral-7b-instruct-v0.1.Q4_0.gguf": "Mistral Instruct",
	"gpt4all-falcon-newbpe-q4_0.gguf": "GPT4All Falcon",
	"orca-2-7b.Q4_0.gguf": "Orca 2 (Medium)",
	"orca-2-13b.Q4_0.gguf": "Orca 2 (Full)",
	"orca-mini-3b-gguf2-q4_0.gguf": "Mini Orca (Small)",
	"mpt-7b-chat-newbpe-q4_0.gguf": "MPT Chat",
	"wizardlm-13b-v1.2.Q4_0.gguf": "Wizard v1.2",
	"nous-hermes-llama2-13b.Q4_0.gguf": "Hermes 13B",
	"Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf": "Hermes 7B",
	"gpt4all-gpt-3.5-turbo.rmodel": "ChatGPT-3.5 turbo GPT4All",
	"gpt4all-13b-snoozy-q4_0.gguf": "Snoozy",
	"em_german_mistral_v01.Q4_0.gguf": "EM German Mistral",
	"gpt-3.5-turbo": "ChatGPT-3.5 turbo",
	"gpt-4o": "GPT-4o",
	"gpt-4o-mini": "GPT-4o-mini",
	"gpt-4.1": "GPT-4.1",
	"gpt-4.1-mini": "GPT-4.1-mini",
	"gpt-4.1-nano": "GPT-4.1-nano",
	"o3": "o3",
	"o3-mini": "o3-mini",
	"o4-mini": "o4-mini",
	"claude-sonnet-4-6": "Claude Sonnet 4.6",
	"claude-opus-4-6": "Claude Opus 4.6",
	"claude-haiku-4-5-20251001": "Claude Haiku 4.5",
	"gemini-3-pro-preview": "Gemini-3-Pro-Preview",
	"gemini-2.5-pro": "Gemini-2.5-Pro",
	"gemini-flash-latest": "Gemini-Flash-Latest",
	"gemini-flash-lite-latest": "Gemini-Flash-Lite-Latest",
	"gemini-2.5-flash": "Gemini-2.5-Flash",
	"gemini-2.5-flash-lite": "Gemini-2.5-Flash-Lite",
	"gemini-2.0-flash": "Gemini-2.0-Flash",
	"gemini-2.0-flash-lite": "Gemini-2.0-Flash-Lite",
	"claude-code": "Claude Code",
	// "text-embedding-3-small": "Text Embedding 3 (Small)",
	"gpt-image-1": "GPT Image 1",
	"mistral-large-latest": "Mistral Large",
	"mistral-medium-latest": "Mistral Medium",
	"mistral-small-latest": "Mistral Small",
	"mistral-nemo-12b-24-07": "Mistral Nemo",
	"magistral-medium-latest": "Magistral Medium",
	"magistral-small-latest": "Magistral Small",
	"devstral-small-latest": "Devstral Small",
	"codestral-latest": "Codestral",
};

/** Set of all OpenAI model id strings — used for provider detection in validation logic. */
export const openAIModelIds: Set<string> = new Set(
	Object.values(openAIModels).map((m) => m.model)
);

export function buildOllamaModels(
	ollamaModelNames: string[],
	contextWindows: Record<string, number> = {}
): { models: Record<string, Model>, names: Record<string, string> } {
	const ollamaModels: Record<string, Model> = {};
	const ollamaNames: Record<string, string> = {};
	for (const name of ollamaModelNames) {
		const displayName = `Ollama: ${name}`;
		ollamaModels[displayName] = {
			model: name,
			type: ollama,
			endpoint: chat,
			url: "/v1/chat/completions",
			contextWindow: contextWindows[name] ?? 8_192,
		};
		ollamaNames[name] = displayName;
	}
	return { models: ollamaModels, names: ollamaNames };
}

export function buildLMStudioModels(lmStudioModelNames: string[]): { models: Record<string, Model>, names: Record<string, string> } {
	const lmStudioModels: Record<string, Model> = {};
	const lmStudioNames: Record<string, string> = {};
	for (const name of lmStudioModelNames) {
		const displayName = `LM Studio: ${name}`;
		lmStudioModels[displayName] = {
			model: name,
			type: lmStudio,
			endpoint: chat,
			url: "/v1/chat/completions",
		};
		lmStudioNames[name] = displayName;
	}
	return { models: lmStudioModels, names: lmStudioNames };
}