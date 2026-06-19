import LLMPlugin from "main";
import { logger } from "./logger";
import { Editor, Platform, requestUrl, RequestUrlParam } from "obsidian";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
	openAI,
	claude,
	chat,
	claudeValidationModel,
	gemini,
	gemini2FlashStableModel,
	images,
} from "utils/constants";
import { query as claudeCodeQuery, CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { ensureSDKInstalled, getNativeBinaryPath } from "services/ClaudeAgentSDKInstaller";

// Patch events.setMaxListeners for Electron compatibility.
// The Agent SDK calls setMaxListeners(n, abortSignal), but Electron's
// renderer-process AbortSignal doesn't extend Node.js EventTarget,
// causing a TypeError. This wrapper catches and ignores that case.
if (Platform.isDesktop) {
	const events = require("events");
	const _origSetMaxListeners = events.setMaxListeners;
	if (_origSetMaxListeners) {
		events.setMaxListeners = function (n: number, ...eventTargets: unknown[]) {
			try {
				return _origSetMaxListeners(n, ...eventTargets);
			} catch {
				// Electron: browser AbortSignal is not a Node.js EventTarget
			}
		};
	}
}
import { models, modelNames } from "utils/models";
import {
	ChatParams,
	ImageParams,
	ProviderKeyPair,
	ViewSettings,
	ViewType,
} from "Types/types";
import { SingletonNotice } from "Plugin/Components/SingletonNotice";
import { GoogleGenAI } from "@google/genai";

async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	maxRetries = 5,
	baseDelayMs = 1000
): Promise<T> {
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error: unknown) {
			const e = error as { status?: number; httpStatus?: number; code?: number; headers?: { get?: (k: string) => string; [k: string]: unknown }; errorDetails?: Array<{ metadata?: { retry_delay?: string } }> };
			const status = e?.status ?? e?.httpStatus ?? e?.code;
			if (status === 429 && attempt < maxRetries) {
				const delay = baseDelayMs * Math.pow(2, attempt);
				const jitter = Math.random() * delay * 0.5;
				await new Promise((r) => window.setTimeout(r, delay + jitter));
				continue;
			}
			if (status === 429) {
				const retryAfter =
					e?.headers?.get?.("retry-after") ??
					e?.headers?.["retry-after"] ??
					e?.errorDetails?.[0]?.metadata?.retry_delay;
				const retryMsg = retryAfter
					? `Rate limit exceeded — retry after ${retryAfter} seconds.`
					: "Rate limit exceeded — please wait a moment and try again.";
				const rateLimitError: Error & { status: number } = Object.assign(new Error(retryMsg), { status: 429 });
				throw rateLimitError;
			}
			throw error;
		}
	}
	throw new Error("retryWithBackoff: unreachable");
}

export function getGpt4AllPath(plugin: LLMPlugin) {
	const platform = plugin.os.platform();
	const homedir = plugin.os.homedir();
	if (platform === "win32") {
		return `${homedir}\\AppData\\Local\\nomic.ai\\GPT4All`;
	} else if (platform === "linux") {
		return `${homedir}/gpt4all`;
	} else {
		// Mac
		return `${homedir}/Library/Application Support/nomic.ai/GPT4All`;
	}
}

export function upperCaseFirst(input: string): string {
	if (input.length === 0) return input;
	return input.charAt(0).toUpperCase() + input.slice(1);
}

export async function messageGPT4AllServer(params: ChatParams, url: string) {
	const body: Record<string, unknown> = {
		model: params.model,
		messages: params.messages,
		temperature: params.temperature,
	};
	if (params.tokens) body.max_tokens = params.tokens;
	const request = {
		url: `http://localhost:4891${url}`,
		method: "POST",
		body: JSON.stringify(body),
	} as RequestUrlParam;
	const response = await requestUrl(request).then((res) => res.json);
	return response.choices[0].message;
}

export async function fetchOllamaContextWindows(
	host: string,
	modelNames: string[]
): Promise<Record<string, number>> {
	const result: Record<string, number> = {};
	for (const name of modelNames) {
		try {
			const res = await requestUrl({
				url: `${host}/api/show`,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name }),
				throw: false,
			});
			const response = res.json;
			const fromInfo = response?.model_info?.["llm.context_length"];
			const fromParams = response?.parameters
				? parseInt(
					(response.parameters as string)
						.split("\n")
						.find((l: string) => l.startsWith("num_ctx"))
						?.split(/\s+/)[1] ?? ""
				)
				: NaN;
			const ctx = fromInfo ?? (isNaN(fromParams) ? undefined : fromParams);
			if (ctx && ctx > 0) result[name] = ctx;
		} catch {
			// silently skip — 8_192 fallback applies in buildOllamaModels
		}
	}
	return result;
}

export async function fetchOllamaModels(host: string): Promise<string[]> {
	const res = await requestUrl({ url: `${host}/api/tags`, throw: false });
	const response = res.json;
	return (response.models || []).map((m: { name: string }) => m.name);
}

/** Fetches the list of models currently loaded in LM Studio via its OpenAI-compatible /v1/models endpoint. */
export async function fetchLMStudioModels(host: string): Promise<string[]> {
	const res = await requestUrl({ url: `${host}/v1/models`, throw: false });
	const response = res.json;
	return (response.data || []).map((m: { id: string }) => m.id);
}

export async function ollamaMessage(params: ChatParams, host: string) {
	const openai = new OpenAI({
		apiKey: "ollama",
		baseURL: `${host}/v1`,
		dangerouslyAllowBrowser: true,
		timeout: 30000,
	});

	const { model, messages, tokens, temperature } = params;
	const stream = await openai.chat.completions.create({
		model,
		messages,
		...(tokens ? { max_tokens: tokens } : {}),
		temperature,
		stream: true,
	});

	return stream;
}

export async function mistralMessage(params: ChatParams, mistralAPIKey: string) {
	const openai = new OpenAI({
		apiKey: mistralAPIKey,
		baseURL: "https://api.mistral.ai/v1",
		dangerouslyAllowBrowser: true,
		fetch: (url: RequestInfo, init?: RequestInit) => {
			if (init?.headers) {
				if (init.headers instanceof Headers) {
					const keysToDelete: string[] = [];
					init.headers.forEach((_v, k) => {
						if (k.toLowerCase().startsWith("x-stainless-")) {
							keysToDelete.push(k);
						}
					});
					keysToDelete.forEach(k => (init.headers as Headers).delete(k));
				} else if (typeof init.headers === "object") {
					for (const key of Object.keys(init.headers)) {
						if (key.toLowerCase().startsWith("x-stainless-")) {
							delete (init.headers as Record<string, string>)[key];
						}
					}
				}
			}
			return window.fetch(url, init);
		},
	});

	const { model, messages, tokens, temperature } = params;
	const stream = await openai.chat.completions.create({
		model,
		messages,
		...(tokens ? { max_tokens: tokens } : {}),
		temperature,
		stream: true,
	});

	return stream;
}

export async function getApiKeyValidity(providerKeyPair: ProviderKeyPair) {
	try {
		const { key, provider } = providerKeyPair;
		if (provider === openAI) {
			const openaiClient = new OpenAI({
				apiKey: key,
				dangerouslyAllowBrowser: true,
			});
			await openaiClient.models.list();
			return { provider, valid: true };
		} else if (provider === claude) {
			const client = new Anthropic({
				apiKey: key,
				dangerouslyAllowBrowser: true,
			});
			await client.messages.create({
				model: claudeValidationModel,
				max_tokens: 1,
				messages: [{ role: "user", content: "Reply 'a'" }],
			});
			return { provider, valid: true };
		} else if (provider === gemini) {
			const client = new GoogleGenAI({ apiKey: key });
			await retryWithBackoff(() =>
				client.models.generateContent({
					model: gemini2FlashStableModel,
					contents: "Reply 'a'",
					config: {
						candidateCount: 1,
						maxOutputTokens: 1,
					},
				})
			);
			return { provider, valid: true };
		}
	} catch (error) {
		if (error.status === 401) {
			logger.error(`Invalid API key for ${providerKeyPair.provider}.`);
			SingletonNotice.show(
				`Invalid API key for ${upperCaseFirst(
					providerKeyPair.provider
				)}.`
			);
		}
		return false;
	}
}

export async function geminiMessage(
	params: ChatParams,
	Gemini_API_KEY: string
) {
	const { model, topP, messages, tokens, temperature, systemContext } = params;
	const client = new GoogleGenAI({ apiKey: Gemini_API_KEY });

	const contents = messages.map((message) => {
		// NOTE -> If we want to provide previous model responses to Gemini, we need to convert them to the correct format.
		// the 'assistant' role is swapped out with the 'model' role.
		const role = message.role === "user" ? "user" : "model";
		return {
			role,
			parts: [{ text: message.content }],
		};
	});

	const stream = await retryWithBackoff(() =>
		client.models.generateContentStream({
			model,
			contents,
			config: {
				candidateCount: 1,
				...(tokens ? { maxOutputTokens: tokens } : {}),
				temperature,
				topP: topP ?? undefined,
				...(systemContext ? { systemInstruction: systemContext } : {}),
			},
		})
	);
	return stream;
}

export async function claudeCodeMessage(
	prompt: string,
	oauthToken: string,
	linearWorkspaces: Array<{ name: string; apiKey: string }>,
	cwd: string,
	pluginDir: string,
	sessionId?: string,
	canUseTool?: CanUseTool
) {
	if (!Platform.isDesktop) throw new Error("Claude Code is only available on desktop.");
	await ensureSDKInstalled(pluginDir);
	const { spawn } = require("child_process");
	const cliPath = getNativeBinaryPath(pluginDir);

	// Build MCP servers and allowedTools from workspace list
	const mcpServers: Record<string, { type: "http"; url: string; headers: Record<string, string> }> = {};
	const allowedTools: string[] = [];

	for (const ws of linearWorkspaces) {
		if (!ws.apiKey) continue;
		// Sanitize name to create a valid MCP server key
		const key = ws.name
			? `linear-${ws.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
			: "linear";
		mcpServers[key] = {
			type: "http",
			url: "https://mcp.linear.app/mcp",
			headers: { Authorization: `Bearer ${ws.apiKey}` },
		};
		allowedTools.push(`mcp__${key}__*`);
	}

	const result = claudeCodeQuery({
		prompt,
		options: {
			pathToClaudeCodeExecutable: cliPath,
			...(sessionId ? { resume: sessionId } : {}),
			spawnClaudeCodeProcess: (options: { command: string; args: string[]; cwd?: string; env?: Record<string, string | undefined> }) => {
				return spawn(options.command, options.args, {
					cwd: options.cwd,
					env: options.env,
					stdio: ["pipe", "pipe", "pipe"],
				});
			},
			...(Object.keys(mcpServers).length > 0
				? { mcpServers, allowedTools }
				: {}),
			permissionMode: "default",
			...(canUseTool ? { canUseTool } : {}),
			cwd,
			env: {
				...process.env,
				CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
			},
		},
	});
	return result;
}

export async function claudeMessage(
	params: ChatParams,
	Claude_API_KEY: string
) {
	const client = new Anthropic({
		apiKey: Claude_API_KEY,
		dangerouslyAllowBrowser: true,
	});

	const { model, messages, tokens, temperature, systemContext } = params;

	// Anthropic SDK Docs - https://github.com/anthropics/anthropic-sdk-typescript/blob/HEAD/helpers.md#messagestream-api
	// Claude API requires max_tokens — omitting it is an error. When the caller
	// passes undefined (smart default / no user override), use a large safe ceiling
	// so the model can respond fully. The caller (resolveEffectiveMaxTokens) already
	// enforces user overrides and model-specific caps before passing tokens here.
	// Claude only accepts "user" | "assistant" in its messages array;
	// system context is passed via the separate `system` parameter.
	type ClaudeMessage = { role: "user" | "assistant"; content: string };
	const stream = client.messages.stream({
		model,
		messages: messages.filter(m => m.role !== "system") as ClaudeMessage[],
		max_tokens: tokens ?? 64_000,
		temperature,
		stream: true,
		...(systemContext ? { system: systemContext } : {}),
	});
	return stream;
}

/* FOR NOW USING GPT4ALL PARAMS, BUT SHOULD PROBABLY MAKE NEW OPENAI PARAMS TYPE */
export async function openAIMessage(
	params: ChatParams | ImageParams,
	OpenAI_API_Key: string,
	endpoint: string,
	endpointType: string
) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	if (endpointType === chat) {
		const { model, messages, tokens, temperature } = params as ChatParams;
		const stream = await openai.chat.completions.create(
			{
				model,
				messages,
				...(tokens ? { max_tokens: tokens } : {}),
				temperature,
				stream: true,
				stream_options: { include_usage: true },
			},
			{ path: endpoint }
		);

		return stream;
	}

	if (endpointType === images) {
		const {
			prompt,
			model,
			quality,
			size,
			numberOfImages,
			response_format,
		} = params as ImageParams;
		const validQualities: string[] = ["low", "medium", "high", "auto"];
		const normalizedQuality = validQualities.includes(quality ?? "")
			? quality : "auto";
		const image = await openai.images.generate({
			model,
			prompt,
			size: size,
			quality: normalizedQuality,
			n: numberOfImages,
			response_format: response_format ?? "url",
		});
		const imageURLs: string[] = [];
		image.data?.map((image) => {
			if (image.b64_json) {
				imageURLs.push(`data:image/png;base64,${image.b64_json}`);
			} else {
				imageURLs.push(image.url!);
			}
		});
		return imageURLs;
	}
}

export function processReplacementTokens(prompt: string) {
	const tokenRegex = /\{\{(.*?)\}\}/g;
	const matches = [...prompt.matchAll(tokenRegex)];
	matches.forEach((match) => {
		const token = match[1] as keyof typeof this.replacementTokens;
		if (this.replacementTokens[token]) {
			prompt = this.replacementTokens[token](match, prompt);
		}
	});

	return prompt;
}

export function getViewInfo(
	plugin: LLMPlugin,
	viewType: ViewType
): ViewSettings {
	if (viewType === "modal") {
		return {
			imageSettings: plugin.settings.modalSettings.imageSettings,
			chatSettings: plugin.settings.modalSettings.chatSettings,
			model: plugin.settings.modalSettings.model,
			modelName: plugin.settings.modalSettings.modelName,
			modelType: plugin.settings.modalSettings.modelType,
			historyIndex: plugin.settings.modalSettings.historyIndex,
			historyFilePath: plugin.settings.modalSettings.historyFilePath ?? null,
			modelEndpoint: plugin.settings.modalSettings.modelEndpoint,
			endpointURL: plugin.settings.modalSettings.endpointURL,
			contextSettings: plugin.settings.modalSettings.contextSettings,
			agentSettings: plugin.settings.modalSettings.agentSettings,
		};
	}

	if (viewType === "widget") {
		return {
			imageSettings: plugin.settings.widgetSettings.imageSettings,
			chatSettings: plugin.settings.widgetSettings.chatSettings,
			model: plugin.settings.widgetSettings.model,
			modelName: plugin.settings.widgetSettings.modelName,
			modelType: plugin.settings.widgetSettings.modelType,
			historyIndex: plugin.settings.widgetSettings.historyIndex,
			historyFilePath: plugin.settings.widgetSettings.historyFilePath ?? null,
			modelEndpoint: plugin.settings.widgetSettings.modelEndpoint,
			endpointURL: plugin.settings.widgetSettings.endpointURL,
			contextSettings: plugin.settings.widgetSettings.contextSettings,
			agentSettings: plugin.settings.widgetSettings.agentSettings,
		};
	}

	if (viewType === "floating-action-button") {
		return {
			imageSettings: plugin.settings.fabSettings.imageSettings,
			chatSettings: plugin.settings.fabSettings.chatSettings,
			model: plugin.settings.fabSettings.model,
			modelName: plugin.settings.fabSettings.modelName,
			modelType: plugin.settings.fabSettings.modelType,
			historyIndex: plugin.settings.fabSettings.historyIndex,
			historyFilePath: plugin.settings.fabSettings.historyFilePath ?? null,
			modelEndpoint: plugin.settings.fabSettings.modelEndpoint,
			endpointURL: plugin.settings.fabSettings.endpointURL,
			contextSettings: plugin.settings.fabSettings.contextSettings,
			agentSettings: plugin.settings.fabSettings.agentSettings,
		};
	}

	return {
		imageSettings: {
			numberOfImages: 0,
			response_format: "url",
			size: "1024x1024",
			quality: "medium",
		},
		chatSettings: { maxTokens: 0, temperature: 0 },
		model: "",
		modelName: "",
		modelType: "",
		historyIndex: -1,
		historyFilePath: null,
		modelEndpoint: "",
		endpointURL: "",
		contextSettings: {
			includeActiveFile: false,
			includeSelection: false,
			selectedFiles: [],
			maxContextTokensPercent: 0,
			showModelLabel: true,
		},
		agentSettings: { permissionMode: "ask" },
	};
}

export function setHistoryFilePath(
	plugin: LLMPlugin,
	viewType: ViewType,
	filePath: string | null
) {
	const settings: Record<string, string> = {
		modal: "modalSettings",
		widget: "widgetSettings",
		"floating-action-button": "fabSettings",
	};
	const settingType = settings[viewType] as
		| "modalSettings"
		| "widgetSettings"
		| "fabSettings";
	plugin.settings[settingType].historyFilePath = filePath;
	void plugin.saveSettings();
}

export function changeDefaultModel(model: string, plugin: LLMPlugin) {
	plugin.settings.defaultModel = model;
	const modelName = modelNames[model];

	// Modal settings
	plugin.settings.modalSettings.model = model;
	plugin.settings.modalSettings.modelName = modelName;
	plugin.settings.modalSettings.modelType = models[modelName].type;
	plugin.settings.modalSettings.endpointURL = models[modelName].url;
	plugin.settings.modalSettings.modelEndpoint = models[modelName].endpoint;

	// Widget settings
	plugin.settings.widgetSettings.model = model;
	plugin.settings.widgetSettings.modelName = modelName;
	plugin.settings.widgetSettings.modelType = models[modelName].type;
	plugin.settings.widgetSettings.endpointURL = models[modelName].url;
	plugin.settings.widgetSettings.modelEndpoint = models[modelName].endpoint;

	// FAB settings
	plugin.settings.fabSettings.model = model;
	plugin.settings.fabSettings.modelName = modelName;
	plugin.settings.fabSettings.modelType = models[modelName].type;
	plugin.settings.fabSettings.endpointURL = models[modelName].url;
	plugin.settings.fabSettings.modelEndpoint = models[modelName].endpoint;

	void plugin.saveSettings();
}

export function setHistoryIndex(
	plugin: LLMPlugin,
	viewType: ViewType,
	length?: number
) {
	const settings: Record<string, string> = {
		modal: "modalSettings",
		widget: "widgetSettings",
		"floating-action-button": "fabSettings",
	};
	const settingType = settings[viewType] as
		| "modalSettings"
		| "widgetSettings"
		| "fabSettings";
	if (!length) {
		plugin.settings[settingType].historyIndex = -1;
		void plugin.saveSettings();
		return;
	}
	plugin.settings[settingType].historyIndex = length - 1;
	void plugin.saveSettings();
}

export function setView(plugin: LLMPlugin, viewType: ViewType) {
	plugin.settings.currentView = viewType
	void plugin.saveSettings();
}

function moveCursorToEndOfFile(editor: Editor) {
	try {
		const length = editor.lastLine();

		const newCursor = {
			line: length + 1,
			ch: 0,
		};
		editor.setCursor(newCursor);

		return newCursor;
	} catch (err) {
		throw new Error("Error moving cursor to end of file", { cause: err });
	}
}

export function appendMessage(editor: Editor, message: string) {
	moveCursorToEndOfFile(editor);
	const newLine = `${message}\n`;
	editor.replaceRange(newLine, editor.getCursor());

	moveCursorToEndOfFile(editor);
}

export function getSettingType(viewType: ViewType) {
	const settings: Record<string, string> = {
		modal: "modalSettings",
		widget: "widgetSettings",
		"floating-action-button": "fabSettings",
	};
	const settingType = settings[viewType] as
		| "modalSettings"
		| "widgetSettings"
		| "fabSettings";

	return settingType;
}

