import LLMPlugin, { LLMPluginSettings } from "main";
import { FileSystem } from "services/FileSystem";
import { Editor, requestUrl, RequestUrlParam } from "obsidian";
import OpenAI, { toFile } from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
	openAI,
	claude,
	chat,
	claudeSonnetJuneModel,
	gemini,
	geminiModel,
} from "utils/constants";
import { query as claudeCodeQuery } from "@anthropic-ai/claude-agent-sdk";

// Patch events.setMaxListeners for Electron compatibility.
// The Agent SDK calls setMaxListeners(n, abortSignal), but Electron's
// renderer-process AbortSignal doesn't extend Node.js EventTarget,
// causing a TypeError. This wrapper catches and ignores that case.
const events = require("events");
const _origSetMaxListeners = events.setMaxListeners;
if (_origSetMaxListeners) {
	events.setMaxListeners = function (n: number, ...eventTargets: any[]) {
		try {
			return _origSetMaxListeners(n, ...eventTargets);
		} catch {
			// Electron: browser AbortSignal is not a Node.js EventTarget
		}
	};
}
import { models, modelNames } from "utils/models";
import {
	ChatParams,
	ImageParams,
	Message,
	ProviderKeyPair,
	ViewSettings,
	ViewType,
} from "Types/types";
import { SingletonNotice } from "Plugin/Components/SingletonNotice";
import { Assistant } from "openai/resources/beta/assistants";
import { GoogleGenAI } from "@google/genai";

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
	const request = {
		url: `http://localhost:4891${url}`,
		method: "POST",
		body: JSON.stringify({
			model: params.model,
			messages: params.messages,
			max_tokens: params.tokens,
			temperature: params.temperature,
		}),
	} as RequestUrlParam;
	const response = await requestUrl(request).then((res) => res.json);
	return response.choices[0].message;
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
				model: claudeSonnetJuneModel,
				max_tokens: 1,
				messages: [{ role: "user", content: "Reply 'a'" }],
			});
			return { provider, valid: true };
		} else if (provider === gemini) {
			const client = new GoogleGenAI({ apiKey: key });
			await client.models.generateContent({
				model: geminiModel,
				contents: "Reply 'a'",
				config: {
					candidateCount: 1,
					maxOutputTokens: 1,
				},
			});
			return { provider, valid: true };
		}
	} catch (error) {
		if (error.status === 401) {
			console.error(`Invalid API key for ${providerKeyPair.provider}.`);
			SingletonNotice.show(
				`Invalid API key for ${upperCaseFirst(
					providerKeyPair.provider
				)}.`
			);
		} else {
			console.log("An error occurred:", error.message);
		}
		return false;
	}
}

export async function geminiMessage(
	params: ChatParams,
	Gemini_API_KEY: string
) {
	const { model, topP, messages, tokens, temperature } = params as ChatParams;
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

	const stream = await client.models.generateContentStream({
		model,
		contents,
		config: {
			candidateCount: 1,
			maxOutputTokens: tokens,
			temperature,
			topP: topP ?? undefined,
		},
	});
	return stream;
}

// Resolve the absolute path to `node` by checking common install locations.
// Electron's renderer process has a limited PATH, so we check the filesystem directly.
function resolveNodePath(): string {
	const fs = require("fs");
	const homedir = require("os").homedir();
	const candidates: string[] = [];

	// nvm — pick the latest installed version
	const nvmDir = `${homedir}/.nvm/versions/node`;
	try {
		if (fs.existsSync(nvmDir)) {
			const versions = fs.readdirSync(nvmDir).sort().reverse();
			if (versions.length > 0) {
				candidates.push(`${nvmDir}/${versions[0]}/bin/node`);
			}
		}
	} catch { /* ignore */ }

	candidates.push(
		`${homedir}/.volta/bin/node`,                       // volta
		`${homedir}/.local/share/fnm/aliases/default/bin/node`, // fnm
		`${homedir}/.asdf/shims/node`,                      // asdf
		`${homedir}/.local/bin/node`,
		"/usr/local/bin/node",
		"/usr/bin/node",
		"/snap/bin/node",
	);

	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) {
				return candidate;
			}
		} catch { /* ignore */ }
	}

	console.warn("[Claude Code] Could not find node binary, falling back to 'node'");
	return "node";
}

export function claudeCodeMessage(
	prompt: string,
	oauthToken: string,
	linearWorkspaces: Array<{ name: string; apiKey: string }>,
	cwd: string,
	pluginDir: string,
	sessionId?: string
) {
	const path = require("path");
	const { spawn } = require("child_process");
	const cliPath = path.join(
		pluginDir,
		"node_modules",
		"@anthropic-ai",
		"claude-agent-sdk",
		"cli.js"
	);
	const nodePath = resolveNodePath();

	// Build MCP servers and allowedTools from workspace list
	const mcpServers: Record<string, any> = {};
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
			spawnClaudeCodeProcess: (options: any) => {
				const cmd =
					options.command === "node" ? nodePath : options.command;
				return spawn(cmd, options.args, {
					cwd: options.cwd,
					env: options.env,
					stdio: ["pipe", "pipe", "pipe"],
				});
			},
			...(Object.keys(mcpServers).length > 0
				? { mcpServers, allowedTools }
				: {}),
			permissionMode: "acceptEdits",
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

	const { model, messages, tokens, temperature } = params as ChatParams;

	// Anthropic SDK Docs - https://github.com/anthropics/anthropic-sdk-typescript/blob/HEAD/helpers.md#messagestream-api
	const stream = client.messages.stream({
		model,
		messages,
		max_tokens: tokens,
		temperature,
		stream: true,
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
				max_tokens: tokens,
				temperature,
				stream: true,
			},
			{ path: endpoint }
		);

		return stream;
	}

	if (endpointType === "images") {
		const {
			prompt,
			model,
			quality,
			size,
			style,
			numberOfImages,
		} = params as ImageParams;
		const image = await openai.images.generate({
			model,
			prompt,
			size: size as
				| "256x256"
				| "512x512"
				| "1024x1024"
				| "1792x1024"
				| "1024x1792",
			quality,
			n: numberOfImages,
			style,
		});
		let imageURLs: string[] = [];
		image.data?.map((image) => {
			return imageURLs.push(image.url!);
		});
		return imageURLs;
	}
}

export async function assistantsMessage(
	OpenAI_API_Key: string,
	messages: Message[],
	assistant_id: string
) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	const thread = await openai.beta.threads.create({
		messages,
	});

	const stream = openai.beta.threads.runs.stream(thread.id, {
		assistant_id,
	});

	return stream;
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
			assistant: plugin.settings.modalSettings.assistant,
			assistantId: plugin.settings.modalSettings.assistantId,
			imageSettings: plugin.settings.modalSettings.imageSettings,
			chatSettings: plugin.settings.modalSettings.chatSettings,
			model: plugin.settings.modalSettings.model,
			modelName: plugin.settings.modalSettings.modelName,
			modelType: plugin.settings.modalSettings.modelType,
			historyIndex: plugin.settings.modalSettings.historyIndex,
			modelEndpoint: plugin.settings.modalSettings.modelEndpoint,
			endpointURL: plugin.settings.modalSettings.endpointURL,
			contextSettings: plugin.settings.modalSettings.contextSettings,
		};
	}

	if (viewType === "widget") {
		return {
			assistant: plugin.settings.widgetSettings.assistant,
			assistantId: plugin.settings.widgetSettings.assistantId,
			imageSettings: plugin.settings.widgetSettings.imageSettings,
			chatSettings: plugin.settings.widgetSettings.chatSettings,
			model: plugin.settings.widgetSettings.model,
			modelName: plugin.settings.widgetSettings.modelName,
			modelType: plugin.settings.widgetSettings.modelType,
			historyIndex: plugin.settings.widgetSettings.historyIndex,
			modelEndpoint: plugin.settings.widgetSettings.modelEndpoint,
			endpointURL: plugin.settings.widgetSettings.endpointURL,
			contextSettings: plugin.settings.widgetSettings.contextSettings,
		};
	}

	if (viewType === "floating-action-button") {
		return {
			assistant: plugin.settings.fabSettings.assistant,
			assistantId: plugin.settings.fabSettings.assistantId,
			imageSettings: plugin.settings.fabSettings.imageSettings,
			chatSettings: plugin.settings.fabSettings.chatSettings,
			model: plugin.settings.fabSettings.model,
			modelName: plugin.settings.fabSettings.modelName,
			modelType: plugin.settings.fabSettings.modelType,
			historyIndex: plugin.settings.fabSettings.historyIndex,
			modelEndpoint: plugin.settings.fabSettings.modelEndpoint,
			endpointURL: plugin.settings.fabSettings.endpointURL,
			contextSettings: plugin.settings.fabSettings.contextSettings,
		};
	}

	return {
		assistant: false,
		assistantId: "",
		imageSettings: {
			numberOfImages: 0,
			response_format: "url",
			size: "1024x1024",
			style: "natural",
			quality: "standard",
		},
		chatSettings: { maxTokens: 0, temperature: 0 },
		model: "",
		modelName: "",
		modelType: "",
		historyIndex: -1,
		modelEndpoint: "",
		endpointURL: "",
		contextSettings: {
			includeActiveFile: false,
			includeSelection: false,
			selectedFiles: [],
			maxContextTokensPercent: 0,
		},
	};
}

export function changeDefaultModel(model: string, plugin: LLMPlugin) {
	plugin.settings.defaultModel = model;
	// Question -> why do we not update the FAB model here?
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

	plugin.saveSettings();
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
		plugin.saveSettings();
		return;
	}
	plugin.settings[settingType].historyIndex = length - 1;
	plugin.saveSettings();
}

export function setView(plugin: LLMPlugin, viewType: ViewType) {
	plugin.settings.currentView = viewType
	plugin.saveSettings();
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
		throw new Error("Error moving cursor to end of file" + err);
	}
}

export function appendMessage(editor: Editor, message: string) {
	moveCursorToEndOfFile(editor!);
	const newLine = `${message}\n`;
	editor.replaceRange(newLine, editor.getCursor());

	moveCursorToEndOfFile(editor!);
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

export async function createAssistant(
	assistantObj: any,
	OpenAI_API_Key: string
) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	const assistant = await openai.beta.assistants.create(assistantObj);
	return assistant;
}

export function getAssistant(plugin: LLMPlugin, assistant_id: string) {
	return plugin.settings.assistants.find(
		(assistant) => assistant.id === assistant_id
	) as Assistant & { modelType: string };
}

export async function listAssistants(OpenAI_API_Key: string) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	const myAssistants = await openai.beta.assistants.list();

	return myAssistants.data;
}

export async function generateAssistantsList(settings: LLMPluginSettings) {
	const assisitantsFromOpenAI = await listAssistants(settings.openAIAPIKey);
	const processedAssisitants = assisitantsFromOpenAI.map(
		(assistant: Assistant & { modelType: string }) => ({
			...assistant,
			modelType: assistant,
		})
	);
	settings.assistants = processedAssisitants;
}

export async function deleteAssistant(
	OpenAI_API_Key: string,
	assistant_id: string
) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	await openai.beta.assistants.delete(assistant_id);
}

export async function listVectors(OpenAI_API_Key: string) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	const vectorStores = await openai.vectorStores.list();
	return vectorStores.data;
}

export async function deleteVector(OpenAI_API_Key: string, vector_id: string) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	await openai.vectorStores.delete(vector_id);
}

export async function createVectorAndUpdate(
	files: string[],
	assistant: Assistant,
	OpenAI_API_Key: string,
	fileSystem: FileSystem
) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	const file_ids = await Promise.all(
		files.map(async (filePath) => {
			const stream = await fileSystem.createReadStream(filePath);
			const reader = stream.getReader();
			const chunks = [];
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				chunks.push(value);
			}
			const fileContent = new Uint8Array(chunks.flat());
			const fileToUpload = await toFile(
				new Blob([fileContent]),
				filePath
			); // Pass filename to preserve extension
			const file = await openai.files.create({
				file: fileToUpload,
				purpose: "assistants",
			});
			return file.id;
		})
	);

	let vectorStore = await openai.vectorStores.create({
		name: "Assistant Files",
	});

	await openai.vectorStores.fileBatches.create(vectorStore.id, {
		file_ids,
	});

	await openai.beta.assistants.update(assistant.id, {
		tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
	});

	return vectorStore.id;
}
