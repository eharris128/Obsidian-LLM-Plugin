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
import {
	GoogleGenerativeAI,
	Content,
	GenerateContentRequest,
} from "@google/generative-ai";

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
			const client = new GoogleGenerativeAI(key);
			const model = client.getGenerativeModel({
				model: geminiModel,
				generationConfig: {
					candidateCount: 1,
					maxOutputTokens: 1,
				},
			});
			await model.generateContent("Reply 'a'");
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
	// Docs - https://ai.google.dev/api/generate-content#v1beta.GenerationConfig
	const genAI = new GoogleGenerativeAI(Gemini_API_KEY);
	const client = genAI.getGenerativeModel({
		model,
		generationConfig: {
			candidateCount: 1,
			maxOutputTokens: tokens,
			temperature,
			topP: topP ?? undefined,
		},
	});

	const contents: Content[] = messages.map((message) => {
		// NOTE -> If we want to provide previous model responses to Gemini, we need to convert them to the correct format.
		// the 'asisstant' role is swapped out with the 'model' role.
		// Docs reference - C:\Users\echar\Documents\llm-plugin-vault\.obsidian\plugins\Obsidian-LLM-Plugin\node_modules\@google\generative-ai\dist\generative-ai.d.ts
		const role = message.role === "user" ? "user" : "model";
		return {
			role,
			parts: [{ text: message.content }], // Convert content to Part[]
		};
	});
	const generateContentRequest: GenerateContentRequest = { contents };
	const stream = await client.generateContentStream(generateContentRequest);
	return stream;
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
		image.data.map((image) => {
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

	await openai.beta.assistants.del(assistant_id);
}

export async function listVectors(OpenAI_API_Key: string) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	const vectorStores = await openai.beta.vectorStores.list();
	return vectorStores.data;
}

export async function deleteVector(OpenAI_API_Key: string, vector_id: string) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	await openai.beta.vectorStores.del(vector_id);
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

	let vectorStore = await openai.beta.vectorStores.create({
		name: "Assistant Files",
	});

	await openai.beta.vectorStores.fileBatches.create(vectorStore.id, {
		file_ids,
	});

	await openai.beta.assistants.update(assistant.id, {
		tool_resources: { file_search: { vector_store_ids: [vectorStore.id] } },
	});

	return vectorStore.id;
}
