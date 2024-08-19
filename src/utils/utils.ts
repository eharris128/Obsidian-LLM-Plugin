import { existsSync } from "fs";
import fs from "fs";
import path from "path";
import LLMPlugin from "main";
import { Editor } from "obsidian";
import OpenAI, { toFile } from "openai";
import {
	ChatParams,
	ImageParams,
	Message,
	SpeechParams,
	ViewSettings,
	ViewType,
} from "Types/types";
import {
	SingletonNotice
} from "Plugin/Components/SingletonNotice"
import { Assistant } from "openai/resources/beta/assistants";

const homeDir = require("os").homedir();
export const DEFAULT_DIRECTORY = path.resolve(
	homeDir,
	navigator.platform.indexOf("Win") > -1
		? "AppData/Local/nomic.ai/GPT4All/"
		: "Library/Application Support/nomic.ai/GPT4All"
);

export function isWindows() {
	return navigator.platform.indexOf("Win") > -1
}

export function modelLookup(modelName: string) {
	const model = path.join(DEFAULT_DIRECTORY, modelName);
	return existsSync(model);
}

export async function messageGPT4AllServer(params: ChatParams, url: string) {
	const response = await fetch(`http://localhost:4891${url}`, {
		method: "POST",
		body: JSON.stringify({
			model: params.model,
			messages: params.messages,
			max_tokens: params.tokens,
			temperature: params.temperature,
		}),
	}).then((res) => res.json());
	return response.choices[0].message;
}

export async function getApiKeyValidity(apiKey: string) {
	try {
		// Make a simple API request to list models (this is lightweight)
		const openai = new OpenAI({
			apiKey,
			dangerouslyAllowBrowser: true,
		});
		await openai.models.list();
		return true
	  } catch (error) {
		if (error.status === 401) {
		  	console.error("Invalid API key.");
			SingletonNotice.show("Invalid API Key");
		} else {
		  console.log("An error occurred:", error.message);
		}
		return false
	  }
}


/* FOR NOW USING GPT4ALL PARAMS, BUT SHOULD PROBABLY MAKE NEW OPENAI PARAMS TYPE */
export async function openAIMessage(
	params: ChatParams | ImageParams | SpeechParams,
	OpenAI_API_Key: string,
	endpoint: string,
	endpointType: string
) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	if (endpointType === "chat") {
		const { prompt, model, messages, tokens, temperature } =
			params as ChatParams;
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
			messages,
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

	if (endpointType === "speech") {
		const { input, model, voice, responseFormat, speed } =
			params as SpeechParams;
		const filename = input.split(" ")[0];
		const speechfile = path.resolve(`./${filename}.${responseFormat}`);

		const response = await openai.audio.speech.create({
			model,
			voice: voice as
				| "alloy"
				| "echo"
				| "fable"
				| "onyx"
				| "nova"
				| "shimmer",
			input,
		});
		console.log(response);
		console.log(speechfile);
		// const buffer = Buffer.from(await response.arrayBuffer());
		// await fs.promises.writeFile(speechfile, buffer);
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
			speechSettings: plugin.settings.modalSettings.speechSettings,
			model: plugin.settings.modalSettings.model,
			modelName: plugin.settings.modalSettings.modelName,
			modelType: plugin.settings.modalSettings.modelType,
			historyIndex: plugin.settings.modalSettings.historyIndex,
			modelEndpoint: plugin.settings.modalSettings.modelEndpoint,
			endpointURL: plugin.settings.modalSettings.endpointURL,
		};
	}

	if (viewType === "widget") {
		return {
			assistant: plugin.settings.widgetSettings.assistant,
			assistantId: plugin.settings.widgetSettings.assistantId,
			imageSettings: plugin.settings.widgetSettings.imageSettings,
			chatSettings: plugin.settings.widgetSettings.chatSettings,
			speechSettings: plugin.settings.widgetSettings.speechSettings,
			model: plugin.settings.widgetSettings.model,
			modelName: plugin.settings.widgetSettings.modelName,
			modelType: plugin.settings.widgetSettings.modelType,
			historyIndex: plugin.settings.widgetSettings.historyIndex,
			modelEndpoint: plugin.settings.widgetSettings.modelEndpoint,
			endpointURL: plugin.settings.widgetSettings.endpointURL,
		};
	}

	if (viewType === "floating-action-button") {
		return {
			assistant: plugin.settings.fabSettings.assistant,
			assistantId: plugin.settings.fabSettings.assistantId,
			imageSettings: plugin.settings.fabSettings.imageSettings,
			chatSettings: plugin.settings.fabSettings.chatSettings,
			speechSettings: plugin.settings.fabSettings.speechSettings,
			model: plugin.settings.fabSettings.model,
			modelName: plugin.settings.fabSettings.modelName,
			modelType: plugin.settings.fabSettings.modelType,
			historyIndex: plugin.settings.fabSettings.historyIndex,
			modelEndpoint: plugin.settings.fabSettings.modelEndpoint,
			endpointURL: plugin.settings.fabSettings.endpointURL,
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
		speechSettings: { voice: "", responseFormat: "", speed: 0 },
		model: "",
		modelName: "",
		modelType: "",
		historyIndex: -1,
		modelEndpoint: "",
		endpointURL: "",
	};
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

export function appendMessage(editor: Editor, message: string, type?: string) {
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
		(assistant) => (assistant.id === assistant_id)
	) as Assistant & { modelType: string };
}

export async function listAssistants(OpenAI_API_Key: string) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	const myAssistants = await openai.beta.assistants.list();

	  return myAssistants.data
}

export async function generateAssistantsList(plugin: LLMPlugin) {
	const assisitantsFromOpenAI = await listAssistants(
		plugin.settings.openAIAPIKey
	);
	const processedAssisitants = assisitantsFromOpenAI.map(
		(assistant: Assistant & { modelType: string }) => ({
			...assistant,
			modelType: "assistant",
		})
	);
	plugin.settings.assistants = processedAssisitants;
}

export async function deleteAssistant(OpenAI_API_Key: string, assistant_id: string) {
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
	return vectorStores.data
}

export async function deleteVector(OpenAI_API_Key: string, vector_id: string) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	await openai.beta.vectorStores.del(vector_id)
}

export async function createVectorAndUpdate(
	files: string[],
	assistant: Assistant,
	OpenAI_API_Key: string
) {
	const openai = new OpenAI({
		apiKey: OpenAI_API_Key,
		dangerouslyAllowBrowser: true,
	});

	const file_ids = await Promise.all(
		files.map(async (filePath) => {
			const fileToUpload = await toFile(fs.createReadStream(filePath));
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
