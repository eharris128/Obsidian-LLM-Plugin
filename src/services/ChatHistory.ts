import { Notice, TFile, parseYaml } from "obsidian";
import LLMPlugin from "main";
import { ChatHistoryItem, HistoryItem, Message, ToolCallRecord, VaultContext } from "Types/types";

export interface ChatFileMeta {
	type: "Chat";
	title: string;
	created: string;
	updated: string;
	model: string;
	provider: string;
	tags: string[];
	context?: string[];
}

export interface LoadedChat {
	meta: ChatFileMeta;
	messages: Message[];
	filePath: string;
	toolCallsByTurn: Map<number, ToolCallRecord[]>;
}

/**
 * Handles reading and writing LLM conversations as individual markdown files
 * in the user's vault. Each file uses YAML frontmatter for metadata and
 * ## User / ## Assistant headings to delimit messages.
 */
export class ChatHistory {
	constructor(private plugin: LLMPlugin) {}

	get folder(): string {
		return this.plugin.settings.chatHistoryFolder || "LLM Chats";
	}

	// ─── Folder ──────────────────────────────────────────────────────────────

	async ensureFolder(): Promise<void> {
		const exists = await this.plugin.app.vault.adapter.exists(this.folder);
		if (!exists) {
			await this.plugin.app.vault.createFolder(this.folder);
		}
	}

	// ─── Naming ──────────────────────────────────────────────────────────────

	/** Convert a human title to a kebab-case filename slug. */
	slugify(title: string): string {
		return title
			.toLowerCase()
			.replace(/[^\w\s-]/g, "")   // strip special chars
			.replace(/\s+/g, "-")        // spaces → hyphens
			.replace(/-+/g, "-")         // collapse runs
			.replace(/^-|-$/g, "")       // trim edges
			.slice(0, 80);               // cap length
	}

	/**
	 * Return a path that doesn't collide with existing files.
	 * Appends -2, -3 … when the base name is already taken.
	 */
	async uniquePath(slug: string): Promise<string> {
		const base = `${this.folder}/${slug}`;
		let path = `${base}.md`;
		let counter = 2;
		while (await this.plugin.app.vault.adapter.exists(path)) {
			path = `${base}-${counter}.md`;
			counter++;
		}
		return path;
	}

	// ─── Serialisation ───────────────────────────────────────────────────────

	/** Render YAML frontmatter manually (avoids external YAML serialiser dep). */
	private buildFrontmatter(meta: ChatFileMeta): string {
		const lines: string[] = [
			`type: Chat`,
			`title: "${meta.title.replace(/"/g, '\\"')}"`,
			`created: "${meta.created}"`,
			`updated: "${meta.updated}"`,
			`model: "${meta.model}"`,
			`provider: "${meta.provider}"`,
			`tags:`,
			...meta.tags.map((t) => `  - ${t}`),
		];
		if (meta.context?.length) {
			lines.push("context:");
			for (const link of meta.context) {
				lines.push(`  - "${link}"`);
			}
		}
		return lines.join("\n");
	}

	/** Render messages + optional selected-text callout as markdown. */
	private messagesToMarkdown(
		messages: Message[],
		selectedText?: string,
		toolCallsByTurn?: Map<number, ToolCallRecord[]>
	): string {
		let body = "";
		let assistantIdx = 0;

		if (selectedText?.trim()) {
			body += `> [!quote] Selected text\n`;
			body += selectedText
				.split("\n")
				.map((l) => `> ${l}`)
				.join("\n");
			body += "\n\n";
		}

		for (const msg of messages) {
			if (msg.role === "system") continue;
			if (msg.role === "assistant") {
				body += `## Assistant\n\n`;
				const toolCalls = toolCallsByTurn?.get(assistantIdx);
				if (toolCalls?.length) {
					body += this.renderToolCallBlock(toolCalls);
				}
				body += `${msg.content}\n\n`;
				assistantIdx++;
			} else {
				body += `## User\n\n${msg.content}\n\n`;
			}
		}

		return body.trimEnd();
	}

	/** Render a collapsible callout listing the tool calls for one agent turn. */
	private renderToolCallBlock(toolCalls: ToolCallRecord[]): string {
		const count = toolCalls.length;
		const label = count === 1 ? "1 tool call" : `${count} tool calls`;
		let block = `> [!info]- ${label}\n`;
		for (const tc of toolCalls) {
			const inputStr = JSON.stringify(tc.input);
			const truncated =
				inputStr.length > 300 ? inputStr.slice(0, 297) + "…" : inputStr;
			block += `>\n> **${tc.name}**\n> \`${truncated}\`\n`;
		}
		block += "\n";
		return block;
	}

	/** Parse messages (and optional selected text) from a markdown body. */
	private markdownToMessages(body: string): {
		messages: Message[];
		selectedText?: string;
	} {
		let selectedText: string | undefined;
		let workingBody = body;

		// Extract leading > [!quote] callout if present
		const calloutRe = /^((?:>.*\n?)+)\n*/;
		const calloutMatch = workingBody.match(calloutRe);
		if (calloutMatch && calloutMatch[0].includes("[!quote]")) {
			selectedText = calloutMatch[1]
				.split("\n")
				.map((l) => l.replace(/^>\s?/, ""))
				.filter((l) => !l.includes("[!quote]"))
				.join("\n")
				.trim();
			workingBody = workingBody.slice(calloutMatch[0].length);
		}

		const messages: Message[] = [];
		// Split on ## User or ## Assistant headings
		const parts = workingBody.split(/\n?## (User|Assistant)\n\n?/);
		// parts[0] = text before first heading (usually empty)
		// then pairs: [heading label, content, heading label, content …]
		for (let i = 1; i < parts.length; i += 2) {
			const role = parts[i] === "User" ? "user" : "assistant";
			let content = (parts[i + 1] ?? "").trim();
			// Strip any leading tool-call callout blocks (written by renderToolCallBlock)
			// so they don't pollute re-submitted conversation context.
			if (role === "assistant") {
				content = content
					.replace(/^> \[!info\]-? \d+ tool calls?\n(?:>[ \t]?[^\n]*\n)*\n?/, "")
					.trim();
			}
			if (content) messages.push({ role, content });
		}

		return { messages, selectedText };
	}

	/** Assemble the complete file content from meta + messages. */
	private buildFileContent(
		meta: ChatFileMeta,
		messages: Message[],
		selectedText?: string,
		toolCallsByTurn?: Map<number, ToolCallRecord[]>
	): string {
		const fm = this.buildFrontmatter(meta);
		const body = this.messagesToMarkdown(messages, selectedText, toolCallsByTurn);
		return `---\n${fm}\n---\n\n${body}`;
	}

	// ─── CRUD ─────────────────────────────────────────────────────────────────

	/**
	 * Save a conversation.
	 * - Pass `filePath = null` to create a new file.
	 * - Pass an existing path to update it.
	 * Returns the (possibly new) file path.
	 */
	async save(
		filePath: string | null,
		title: string,
		messages: Message[],
		item: ChatHistoryItem,
		vaultContext?: VaultContext,
		toolCallsByTurn?: Map<number, ToolCallRecord[]>
	): Promise<string> {
		await this.ensureFolder();

		const now = new Date().toISOString();
		const provider = this.inferProvider(item.model);
		const contextLinks = this.buildContextLinks(vaultContext);
		const selectedText = vaultContext?.selectedText;

		if (filePath) {
			// ── Update existing file ──────────────────────────────────────
			const file = this.plugin.app.vault.getFileByPath(filePath);
			if (!file) throw new Error(`Chat file not found: ${filePath}`);

			const existing = await this.load(filePath);
			const meta: ChatFileMeta = {
				...existing.meta,
				updated: now,
				...(contextLinks.length ? { context: contextLinks } : {}),
			};
			await this.plugin.app.vault.modify(
				file,
				this.buildFileContent(meta, messages, selectedText, toolCallsByTurn)
			);
			return filePath;
		} else {
			// ── Create new file ───────────────────────────────────────────
			const slug = this.slugify(title);
			const newPath = await this.uniquePath(slug);
			const meta: ChatFileMeta = {
				type: "Chat",
				title,
				created: now,
				updated: now,
				model: item.model,
				provider,
				tags: ["llm-chats"],
				...(contextLinks.length ? { context: contextLinks } : {}),
			};
			await this.plugin.app.vault.create(
				newPath,
				this.buildFileContent(meta, messages, selectedText, toolCallsByTurn)
			);
			return newPath;
		}
	}

	/** Read a chat file and return its metadata + messages. */
	async load(filePath: string): Promise<LoadedChat> {
		const file = this.plugin.app.vault.getFileByPath(filePath);
		if (!file) throw new Error(`File not found: ${filePath}`);

		const content = await this.plugin.app.vault.read(file);
		const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
		if (!fmMatch) throw new Error(`Invalid chat file format: ${filePath}`);

		const meta = parseYaml(fmMatch[1]) as ChatFileMeta;
		const rawBody = fmMatch[2].trim();
		const { messages } = this.markdownToMessages(rawBody);
		const toolCallsByTurn = this.parseToolCallsFromBody(rawBody);

		return { meta, messages, filePath, toolCallsByTurn };
	}

	/**
	 * Parse tool-call callout blocks from the raw markdown body.
	 * Returns a map of assistant-turn-index → ToolCallRecord[].
	 */
	private parseToolCallsFromBody(rawBody: string): Map<number, ToolCallRecord[]> {
		const result = new Map<number, ToolCallRecord[]>();
		// Use the same split as markdownToMessages so indices stay in sync.
		const parts = rawBody.split(/\n?## (User|Assistant)\n\n?/);
		let assistantIdx = 0;
		for (let i = 1; i < parts.length; i += 2) {
			if (parts[i] !== "Assistant") continue;
			const section = (parts[i + 1] ?? "").trimStart();
			if (section.startsWith("> [!info]-")) {
				// Extract consecutive lines starting with ">"
				const calloutLines: string[] = [];
				for (const line of section.split("\n")) {
					if (line.startsWith(">")) calloutLines.push(line);
					else break;
				}
				const toolCalls = this.parseToolCallCallout(calloutLines);
				if (toolCalls.length > 0) result.set(assistantIdx, toolCalls);
			}
			assistantIdx++;
		}
		return result;
	}

	/** Extract ToolCallRecords from the lines of one [!info] callout block. */
	private parseToolCallCallout(lines: string[]): ToolCallRecord[] {
		const calls: ToolCallRecord[] = [];
		let currentName: string | null = null;
		for (const line of lines) {
			const nameMatch = line.match(/^> \*\*(.+)\*\*$/);
			const inputMatch = line.match(/^> `(.+)`$/);
			if (nameMatch) {
				currentName = nameMatch[1];
			} else if (inputMatch && currentName) {
				let input: Record<string, any> = {};
				try {
					// Strip truncation marker before parsing
					input = JSON.parse(inputMatch[1].replace(/…$/, ""));
				} catch { /* ignore malformed JSON */ }
				calls.push({ name: currentName, input });
				currentName = null;
			}
		}
		return calls;
	}

	/**
	 * List all chat files in the history folder, newest first.
	 * Uses file mtime so the list stays current without re-reading content.
	 */
	async list(): Promise<TFile[]> {
		const prefix = this.folder + "/";
		return this.plugin.app.vault
			.getFiles()
			.filter((f) => f.path.startsWith(prefix) && f.extension === "md")
			.sort((a, b) => b.stat.mtime - a.stat.mtime);
	}

	/** Delete a chat file permanently. Falls back to adapter.remove() if the
	 *  vault file cache hasn't indexed the file yet (e.g. rapid create→delete). */
	async delete(filePath: string): Promise<void> {
		const file = this.plugin.app.vault.getFileByPath(filePath);
		if (file) {
			await this.plugin.app.vault.trash(file, true);
			return;
		}
		// Fallback: bypass the file cache and remove directly via the adapter.
		const exists = await this.plugin.app.vault.adapter.exists(filePath);
		if (exists) {
			await this.plugin.app.vault.adapter.remove(filePath);
		}
	}

	/**
	 * Rename a conversation: updates the `title` frontmatter field
	 * and renames the file to match the new slug.
	 * Returns the new file path.
	 */
	async rename(filePath: string, newTitle: string): Promise<string> {
		const file = this.plugin.app.vault.getFileByPath(filePath);
		if (!file) throw new Error(`File not found: ${filePath}`);

		const existing = await this.load(filePath);
		const updatedMeta: ChatFileMeta = {
			...existing.meta,
			title: newTitle,
			updated: new Date().toISOString(),
		};

		// Write updated frontmatter first
		await this.plugin.app.vault.modify(
			file,
			this.buildFileContent(updatedMeta, existing.messages)
		);

		// Then rename the file
		const slug = this.slugify(newTitle);
		const newPath = await this.uniquePath(slug);
		await this.plugin.app.vault.rename(file, newPath);
		return newPath;
	}

	// ─── Migration ───────────────────────────────────────────────────────────

	/**
	 * One-time migration: convert `promptHistory` entries to markdown files.
	 * Image history items are skipped (out of scope for now).
	 */
	async migrate(promptHistory: HistoryItem[]): Promise<void> {
		await this.ensureFolder();
		let migrated = 0;
		let skipped = 0;

		for (const item of promptHistory) {
			// Skip image history — only chat items have a messages array
			if (!("messages" in item) || !Array.isArray(item.messages) || !item.messages.length) {
				skipped++;
				continue;
			}

			try {
				const chatItem = item as ChatHistoryItem;
				const firstUser = chatItem.messages.find((m) => m.role === "user");
				const title =
					chatItem.prompt ||
					firstUser?.content?.slice(0, 60) ||
					"Untitled chat";

				await this.save(
					null,
					title,
					chatItem.messages,
					chatItem,
					chatItem.vaultContext
				);
				migrated++;
			} catch (e) {
				console.error("[ChatHistory] Failed to migrate item:", e);
				skipped++;
			}
		}

		new Notice(
			`Migration complete: ${migrated} conversation${migrated !== 1 ? "s" : ""} saved to "${this.folder}".` +
				(skipped ? ` ${skipped} item${skipped !== 1 ? "s" : ""} skipped.` : "")
		);
	}

	// ─── Title generation ────────────────────────────────────────────────────

	/**
	 * Generate a short conversation title.
	 * Calls `generator` (provided by ChatContainer, which knows the active provider).
	 * Falls back to the first 8 words of the first user message if that fails.
	 */
	async generateTitle(
		messages: Message[],
		generator?: () => Promise<string>
	): Promise<string> {
		if (generator) {
			try {
				const result = await generator();
				if (result?.trim()) return result.trim();
			} catch (e) {
				console.warn("[ChatHistory] Title generation failed, using fallback:", e);
			}
		}

		// Fallback: first 8 words of first user message
		const firstUser = messages.find((m) => m.role === "user");
		if (!firstUser?.content) return "untitled-chat";
		return firstUser.content.trim().split(/\s+/).slice(0, 8).join(" ");
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	/** Map a model string to a provider label. */
	private inferProvider(model: string): string {
		if (!model) return "unknown";
		if (model.startsWith("claude")) return "anthropic";
		if (
			model.startsWith("gpt") ||
			model.startsWith("o1") ||
			model.startsWith("o3") ||
			model.startsWith("o4")
		)
			return "openai";
		if (model.startsWith("gemini")) return "google";
		if (model.startsWith("mistral") || model.startsWith("codestral"))
			return "mistral";
		return "local"; // Ollama, GPT4All
	}

	/** Build Obsidian wikilinks from vault context file references. */
	private buildContextLinks(vaultContext?: VaultContext): string[] {
		if (!vaultContext) return [];
		const links: string[] = [];
		if (vaultContext.activeFile) {
			links.push(`[[${vaultContext.activeFile.name}]]`);
		}
		for (const f of vaultContext.additionalFiles ?? []) {
			links.push(`[[${f.name}]]`);
		}
		return links;
	}
}
