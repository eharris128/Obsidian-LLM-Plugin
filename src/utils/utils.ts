import { GPT4AllParams, Message } from "Types/types";
import { existsSync } from "fs";
import { Editor } from "obsidian";

const path = require("path");
const homeDir = require("os").homedir();
export const DEFAULT_DIRECTORY = path.resolve(
	homeDir,
	navigator.platform.indexOf("Win") > -1 ? "AppData/Local/nomic.ai/GPT4All/" : "Library/Application Support/nomic.ai/GPT4All"
);

export function modelLookup(modelName: string) {
	const model = path.join(DEFAULT_DIRECTORY, modelName);
	return existsSync(model);
}

export async function messageGPT4AllServer(params: GPT4AllParams) {
	const response = await fetch("http://localhost:4891/v1/chat/completions", {
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
	let newLine;
	moveCursorToEndOfFile(editor!);

	if (type === "prompt") {
		newLine = `\n\n<hr class="__chatgpt_plugin">\n\nPrompt: ${message}\n\n`;
		editor.replaceRange(newLine, editor.getCursor());
	} else if (type === "response") {
		newLine = `${message}\n\n<hr class="__chatgpt_plugin">\n\n`;
		editor.replaceRange(newLine, editor.getCursor());
	} else {
		newLine = `<hr class="__chatgpt_plugin">\n\n${message}\n\n<hr class="__chatgpt_plugin">\n\n`;
		editor.replaceRange(newLine, editor.getCursor());
	}
	moveCursorToEndOfFile(editor!);
}

export function serializeMessages(messages: Message[]) {
	let response = "";
	messages.forEach((message: Message) => {
		response += `${message.role} : ${message.content}\n\n`;
	});

	return response
}