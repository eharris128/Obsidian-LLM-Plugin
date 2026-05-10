/**
 * MemoryService — extracts, stores, and recalls memories from LLM conversations.
 *
 * Vault folder hierarchy (rooted under LLMPlugin.settings.rootVaultFolder):
 *
 *   AI/
 *     Memories/                          ← global (always recalled)
 *       <uuid>.md
 *     Assistants/<name>/memories/        ← recalled when assistant is active
 *       <uuid>.md
 *     Projects/<name>/memories/          ← recalled when project is active
 *       <uuid>.md
 *
 * Memory file format:
 *   ---
 *   created: <ISO date>
 *   source: <"global" | assistant name | project name>
 *   type: <"fact" | "preference" | "context">
 *   ---
 *   <memory content>
 *
 * Extraction uses a model call with structured JSON output to decide which
 * facts are worth persisting. Deduplication runs a cosine similarity check
 * against existing memories in the same scope folder; a score >= 0.92
 * suppresses the write.
 *
 * Recall queries the VaultIndexer (hybrid search 70% cosine + 30% BM25)
 * across all active scopes and returns a formatted context block.
 */

import { App, Notice } from "obsidian";
import { VaultIndexer, SearchResult } from "RAG/VaultIndexer";
import { EmbeddingService } from "RAG/EmbeddingService";
import { Message } from "Types/types";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Cosine similarity above which we consider a new memory a duplicate. */
const DEDUP_THRESHOLD = 0.92;

/** How many top vault results to show for recalled memories. */
const DEFAULT_RECALL_TOP_K = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

export type MemoryScope = "global" | "assistant" | "project";
export type MemoryType = "fact" | "preference" | "context";

export interface MemoryRecord {
	id: string;
	created: string;
	source: string;       // "global", assistant name, or project name
	type: MemoryType;
	content: string;
	filePath: string;
}

/** Structured output expected from the extraction model call. */
interface ExtractedMemory {
	type: MemoryType;
	content: string;
}

/** Context passed at recall time to determine which scope folders to query. */
export interface MemoryContext {
	activeAssistant?: string;
	activeProject?: string;
}

// ── MemoryService ──────────────────────────────────────────────────────────────

export class MemoryService {
	private rootVaultFolder: string;

	constructor(
		private app: App,
		private embedding: EmbeddingService,
		rootVaultFolder: string,
	) {
		this.rootVaultFolder = rootVaultFolder.replace(/\/$/, "");
	}

	// ── Folder helpers ─────────────────────────────────────────────────────────

	/** Vault-relative path to the global memories folder. */
	globalMemoriesFolder(): string {
		return `${this.rootVaultFolder}/Memories`;
	}

	/** Vault-relative path to an assistant's memories folder. */
	assistantMemoriesFolder(assistantName: string): string {
		return `${this.rootVaultFolder}/Assistants/${assistantName}/memories`;
	}

	/** Vault-relative path to a project's memories folder. */
	projectMemoriesFolder(projectName: string): string {
		return `${this.rootVaultFolder}/Projects/${projectName}/memories`;
	}

	/**
	 * Return all scope folder paths that should be queried at recall time,
	 * given the currently active assistant/project (if any).
	 */
	scopeFolders(ctx: MemoryContext): string[] {
		const folders: string[] = [this.globalMemoriesFolder()];
		if (ctx.activeAssistant) {
			folders.push(this.assistantMemoriesFolder(ctx.activeAssistant));
		}
		if (ctx.activeProject) {
			folders.push(this.projectMemoriesFolder(ctx.activeProject));
		}
		return folders;
	}

	/** Source label written into the frontmatter. */
	private sourceLabel(scope: MemoryScope, name?: string): string {
		if (scope === "global") return "global";
		return name ?? scope;
	}

	// ── Extraction ──────────────────────────────────────────────────────────────

	/**
	 * Extract memories from a conversation using a model call.
	 *
	 * Calls the provided `callModel` function (which wraps the active provider)
	 * and expects a JSON array of { type, content } objects in return.
	 * Writes each memory to the appropriate scope folder after deduplication.
	 *
	 * @param messages    Full conversation history.
	 * @param scope       Which scope folder to write memories into.
	 * @param scopeName   Assistant or project name (required when scope !== "global").
	 * @param callModel   Async fn that takes a system + user prompt and returns the model's text response.
	 * @returns           Number of memories actually written (after deduplication).
	 */
	async extractAndSave(
		messages: Message[],
		scope: MemoryScope,
		scopeName: string | undefined,
		callModel: (system: string, user: string) => Promise<string>,
	): Promise<number> {
		const extracted = await this.extractFromModel(messages, callModel);
		if (extracted.length === 0) return 0;

		const folder = this.folderForScope(scope, scopeName);
		await this.ensureFolder(folder);

		let written = 0;
		for (const mem of extracted) {
			const isDuplicate = await this.isDuplicate(mem.content, folder);
			if (isDuplicate) {
				console.log(`[Memory] Skipping duplicate: "${mem.content.slice(0, 60)}…"`);
				continue;
			}
			await this.writeMemory(folder, scope, scopeName, mem);
			written++;
		}

		if (written > 0) {
			new Notice(`💾 Saved ${written} new memory${written === 1 ? "" : "ies"}.`);
		} else {
			new Notice("No new memories to save (all duplicates).");
		}

		return written;
	}

	/**
	 * Call the model to extract memorable facts from the conversation.
	 * Returns an array of { type, content } objects.
	 */
	private async extractFromModel(
		messages: Message[],
		callModel: (system: string, user: string) => Promise<string>,
	): Promise<ExtractedMemory[]> {
		const system = `You are a memory extraction assistant. Your job is to identify facts,
preferences, or context from a conversation that are worth remembering for future sessions.

Return ONLY a valid JSON array (no markdown, no explanation) of objects with this shape:
[
  { "type": "fact" | "preference" | "context", "content": "<one concise sentence>" },
  ...
]

Guidelines:
- "fact": objective information the user shared (name, role, project details, etc.)
- "preference": how the user likes things done (tone, format, tools, workflow)
- "context": situational background useful for future conversations

Extract only genuinely memorable, reusable information. Return [] if nothing is worth saving.
Keep each content item to one clear, standalone sentence.`;

		const conversationText = messages
			.map((m) => `${m.role.toUpperCase()}: ${m.content}`)
			.join("\n\n");

		const user = `Extract memorable facts from this conversation:\n\n${conversationText}`;

		let raw: string;
		try {
			raw = await callModel(system, user);
		} catch (e) {
			console.error("[Memory] Extraction model call failed:", e);
			new Notice("Memory extraction failed — model call error.");
			return [];
		}

		// Strip markdown code fences if the model wrapped the JSON
		const cleaned = raw
			.replace(/^```(?:json)?\s*/i, "")
			.replace(/\s*```\s*$/, "")
			.trim();

		try {
			const parsed = JSON.parse(cleaned);
			if (!Array.isArray(parsed)) return [];
			return parsed.filter(
				(item: any) =>
					item &&
					typeof item.content === "string" &&
					["fact", "preference", "context"].includes(item.type)
			);
		} catch (e) {
			console.error("[Memory] Failed to parse extraction JSON:", cleaned, e);
			return [];
		}
	}

	// ── Deduplication ────────────────────────────────────────────────────────────

	/**
	 * Check whether `content` is semantically similar to any existing memory
	 * in `folder`. Returns true if the highest cosine similarity >= DEDUP_THRESHOLD.
	 */
	private async isDuplicate(content: string, folder: string): Promise<boolean> {
		const existing = await this.loadMemoriesFromFolder(folder);
		if (existing.length === 0) return false;

		let newVector: number[];
		try {
			newVector = await this.embedding.embed(content);
		} catch (e) {
			// If embedding fails we can't check — allow the write
			console.warn("[Memory] Embedding failed during dedup check:", e);
			return false;
		}

		for (const mem of existing) {
			let existVec: number[];
			try {
				existVec = await this.embedding.embed(mem.content);
			} catch {
				continue;
			}
			const sim = cosineSimilarity(newVector, existVec);
			if (sim >= DEDUP_THRESHOLD) return true;
		}
		return false;
	}

	// ── Persistence ──────────────────────────────────────────────────────────────

	/**
	 * Write a single memory to disk as a markdown file with YAML frontmatter.
	 */
	private async writeMemory(
		folder: string,
		scope: MemoryScope,
		scopeName: string | undefined,
		mem: ExtractedMemory,
	): Promise<void> {
		const id = crypto.randomUUID();
		const created = new Date().toISOString();
		const source = this.sourceLabel(scope, scopeName);

		const fileContent = `---
created: ${created}
source: ${source}
type: ${mem.type}
---

${mem.content}
`;

		const filePath = `${folder}/${id}.md`;
		await this.app.vault.adapter.write(filePath, fileContent);
		console.log(`[Memory] Wrote memory: ${filePath}`);
	}

	// ── Recall ───────────────────────────────────────────────────────────────────

	/**
	 * Recall relevant memories for a query string, searching across all active
	 * scope folders. Returns a formatted system-context block ready to prepend.
	 *
	 * @param query    The user's current prompt.
	 * @param ctx      Active assistant / project scope info.
	 * @param topK     Maximum results per scope (default 5).
	 * @param indexer  VaultIndexer instance (used for hybrid search).
	 * @returns        Formatted context block, or null if nothing was found.
	 */
	async recall(
		query: string,
		ctx: MemoryContext,
		topK: number = DEFAULT_RECALL_TOP_K,
		indexer: VaultIndexer | null,
	): Promise<string | null> {
		if (!indexer) return null;

		const folders = this.scopeFolders(ctx);
		const results: SearchResult[] = [];

		for (const folder of folders) {
			try {
				const folderResults = await this.searchInFolder(query, folder, topK, indexer);
				results.push(...folderResults);
			} catch (e) {
				// Folder may not exist yet — skip silently
				console.debug(`[Memory] Recall skipped folder "${folder}":`, e);
			}
		}

		if (results.length === 0) return null;

		// Sort by score descending, de-duplicate by filePath, take top topK overall
		const seen = new Set<string>();
		const deduped: SearchResult[] = [];
		for (const r of results.sort((a, b) => b.score - a.score)) {
			if (!seen.has(r.filePath)) {
				seen.add(r.filePath);
				deduped.push(r);
				if (deduped.length >= topK) break;
			}
		}

		return formatMemoriesAsContext(deduped);
	}

	/**
	 * Search the VaultIndexer but restrict results to chunks whose filePath
	 * is inside `folder`.
	 */
	private async searchInFolder(
		query: string,
		folder: string,
		topK: number,
		indexer: VaultIndexer,
	): Promise<SearchResult[]> {
		// We fetch more results than needed and filter by folder prefix
		const raw = await indexer.search(query, topK * 4);
		const prefix = folder.endsWith("/") ? folder : folder + "/";
		return raw
			.filter((r) => r.filePath.startsWith(prefix))
			.slice(0, topK);
	}

	// ── Load memory files ────────────────────────────────────────────────────────

	/**
	 * Read all memory markdown files from a folder and return parsed records.
	 * Uses vault.adapter so it works even if Obsidian hasn't indexed the files.
	 */
	async loadMemoriesFromFolder(folder: string): Promise<MemoryRecord[]> {
		let listing: { files: string[]; folders: string[] };
		try {
			listing = await this.app.vault.adapter.list(folder);
		} catch {
			return [];
		}

		const records: MemoryRecord[] = [];
		for (const filePath of listing.files) {
			if (!filePath.endsWith(".md")) continue;
			try {
				const raw = await this.app.vault.adapter.read(filePath);
				const parsed = parseMemoryFile(raw, filePath);
				if (parsed) records.push(parsed);
			} catch (e) {
				console.warn(`[Memory] Failed to read ${filePath}:`, e);
			}
		}
		return records;
	}

	/** True if `path` is inside one of the memories folders (any scope). */
	isMemoryFile(path: string): boolean {
		const root = this.rootVaultFolder;
		return (
			path.startsWith(`${root}/Memories/`) ||
			path.includes("/memories/")
		) && path.endsWith(".md");
	}

	// ── Folder management ────────────────────────────────────────────────────────

	private folderForScope(scope: MemoryScope, name?: string): string {
		if (scope === "global") return this.globalMemoriesFolder();
		if (scope === "assistant" && name) return this.assistantMemoriesFolder(name);
		if (scope === "project" && name) return this.projectMemoriesFolder(name);
		return this.globalMemoriesFolder();
	}

	private async ensureFolder(folder: string): Promise<void> {
		const exists = await this.app.vault.adapter.exists(folder);
		if (!exists) {
			await this.app.vault.adapter.mkdir(folder);
		}
	}
}

// ── Parsing ───────────────────────────────────────────────────────────────────

function parseMemoryFile(raw: string, filePath: string): MemoryRecord | null {
	const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!fmMatch) return null;

	const frontmatter = fmMatch[1];
	const body = fmMatch[2].trim();
	if (!body) return null;

	const id = filePath.split("/").pop()?.replace(".md", "") ?? crypto.randomUUID();
	const created = yamlString(frontmatter, "created") ?? new Date().toISOString();
	const source = yamlString(frontmatter, "source") ?? "global";
	const type = (yamlString(frontmatter, "type") ?? "fact") as MemoryType;

	return { id, created, source, type, content: body, filePath };
}

function yamlString(yaml: string, key: string): string | null {
	const re = new RegExp(`^${key}:\\s*(.+)$`, "m");
	const m = yaml.match(re);
	if (!m) return null;
	return m[1].trim().replace(/^["']|["']$/g, "");
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatMemoriesAsContext(results: SearchResult[]): string {
	const lines = [
		"# Recalled Memories",
		"",
		"The following memories from previous conversations may be relevant:",
		"",
	];

	for (const r of results) {
		// Strip the chunk prefix added by VaultIndexer (e.g. "[AI/Memories/xxx.md]\n")
		const content = r.text.replace(/^\[[^\]]+\]\n/, "").trim();
		lines.push(`- ${content}`);
	}

	return lines.join("\n");
}

// ── Cosine Similarity ──────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;
	let dot = 0, normA = 0, normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}
