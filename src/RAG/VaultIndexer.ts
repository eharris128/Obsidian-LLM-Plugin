import { App, TFile } from "obsidian";
import { EmbeddingService, OllamaModelNotFoundError } from "./EmbeddingService";
import { VectorStore } from "./VectorStore";

const MAX_CHUNK_CHARS = 1500; // ~375 tokens — safe for all providers
const MIN_CHUNK_CHARS = 50;   // discard near-empty paragraphs

export interface IndexProgress {
	indexed: number;
	total: number;
	currentFile: string;
}

export type ProgressCallback = (progress: IndexProgress) => void;

export interface SearchResult {
	filePath: string;
	text: string;
	score: number;
}

export class VaultIndexer {
	constructor(
		private app: App,
		private store: VectorStore,
		private embedding: EmbeddingService,
	) {}

	// ── Indexing ──────────────────────────────────────────────────────────────

	/**
	 * Index all markdown files in the vault, skipping files whose mtime
	 * hasn't changed since the last run (incremental update).
	 */
	async indexVault(
		excludedFolders: string[] = [],
		onProgress?: ProgressCallback,
	): Promise<{ indexed: number; skipped: number }> {
		// Proactively check that the Ollama model is available before starting
		// so the user gets a clear error immediately rather than failing mid-index.
		await this.embedding.checkOllamaModel();

		await this.store.load();

		const files = this.app.vault
			.getMarkdownFiles()
			.filter(f => !this.isExcluded(f.path, excludedFolders));

		let indexed = 0;
		let skipped = 0;

		for (let i = 0; i < files.length; i++) {
			const file = files[i];
			onProgress?.({ indexed: i, total: files.length, currentFile: file.path });

			const storedMtime = this.store.getMtime(file.path);
			if (storedMtime === file.stat.mtime) {
				skipped++;
				continue;
			}

			await this.indexFile(file);
			indexed++;
		}

		await this.store.save();
		return { indexed, skipped };
	}

	/** Persist the current index to disk. */
	async save(): Promise<void> {
		await this.store.save();
	}

	/** Remove a file from the index and persist. */
	async removeFile(filePath: string): Promise<void> {
		this.store.remove(filePath);
		await this.store.save();
	}

	/** Index (or re-index) a single file. Does NOT call store.save() — caller must. */
	async indexFile(file: TFile): Promise<void> {
		// Ensure the existing index is loaded before upserting, so a subsequent
		// save() doesn't overwrite the full index with just this one file
		// (can happen when the modify event fires before indexVault() has run).
		await this.store.ensureLoaded();
		const content = await this.app.vault.read(file);
		const chunks = chunkMarkdown(content, file.path);
		if (chunks.length === 0) return;

		const vectors = await this.embedding.embedBatch(chunks);
		this.store.upsert(
			file.path,
			file.stat.mtime,
			chunks.map((text, i) => ({ text, vector: vectors[i] })),
		);
	}

	// ── Search ────────────────────────────────────────────────────────────────

	/**
	 * Embed the query and return the top-k matching chunks from the index,
	 * formatted as a markdown context block ready to inject into a system message.
	 */
	async semanticSearch(query: string, topK = 5): Promise<string> {
		await this.store.load();
		const queryVector = await this.embedding.embed(query);
		const results = this.store.hybridSearch(queryVector, query, topK);

		if (results.length === 0) {
			return "No relevant notes found in vault.";
		}

		return formatResultsAsContext(results);
	}

	/**
	 * Raw hybrid search — returns structured results rather than formatted text.
	 * Useful for features like cited sources.
	 */
	async search(query: string, topK = 5): Promise<SearchResult[]> {
		await this.store.load();
		const queryVector = await this.embedding.embed(query);
		return this.store.hybridSearch(queryVector, query, topK);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private isExcluded(filePath: string, excludedFolders: string[]): boolean {
		return excludedFolders.some(folder => {
			const normalized = folder.endsWith("/") ? folder : folder + "/";
			return filePath.startsWith(normalized);
		});
	}

	get indexedFileCount(): number {
		return this.store.size;
	}
}

// ── Chunking ──────────────────────────────────────────────────────────────────

/**
 * Split a markdown document into chunks, prepending file path and the
 * nearest heading to each chunk for retrieval context.
 */
export function chunkMarkdown(content: string, filePath: string): string[] {
	const lines = content.split("\n");
	const chunks: string[] = [];
	let currentHeading = "";
	let buffer = "";

	const flush = () => {
		const trimmed = buffer.trim();
		if (trimmed.length >= MIN_CHUNK_CHARS) {
			const prefix = `[${filePath}${currentHeading ? ` > ${currentHeading}` : ""}]\n`;
			chunks.push(prefix + trimmed);
		}
		buffer = "";
	};

	for (const line of lines) {
		// Track headings for context prefix
		const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
		if (headingMatch) {
			// Flush current buffer before starting a new section
			flush();
			currentHeading = headingMatch[2].trim();
			buffer = line + "\n";
			continue;
		}

		buffer += line + "\n";

		// Flush at paragraph boundaries or when buffer is too large
		if (line.trim() === "" && buffer.trim().length > 0) {
			if (buffer.length >= MAX_CHUNK_CHARS) {
				flush();
			}
		} else if (buffer.length >= MAX_CHUNK_CHARS) {
			flush();
		}
	}

	// Flush remaining content
	flush();

	return chunks;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatResultsAsContext(results: SearchResult[]): string {
	const lines: string[] = [
		"## Relevant notes from your vault",
		"",
		"The following excerpts were retrieved based on semantic similarity to your query.",
		"Use them to inform your response where relevant.",
		"",
	];

	for (const result of results) {
		lines.push(`### ${result.filePath}`);
		lines.push(result.text);
		lines.push("");
	}

	return lines.join("\n");
}
