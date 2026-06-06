import { App } from "obsidian";

export interface VectorChunk {
	text: string;
	vector: number[];
}

export interface VectorEntry {
	filePath: string;
	mtime: number;
	chunks: VectorChunk[];
}

interface IndexFile {
	version: number;
	entries: VectorEntry[];
}

const INDEX_VERSION = 1;

export class VectorStore {
	private entries: Map<string, VectorEntry> = new Map();
	private dirty = false;
	private loaded = false;

	constructor(private app: App, private indexPath: string) {}

	// ── Persistence ──────────────────────────────────────────────────────────

	async load(): Promise<void> {
		try {
			const raw = await this.app.vault.adapter.read(this.indexPath);
			const parsed: IndexFile = JSON.parse(raw);
			if (parsed.version !== INDEX_VERSION) {
				console.warn("[RAG] Index version mismatch — rebuilding");
				this.entries.clear();
				this.loaded = true;
				return;
			}
			this.entries.clear();
			for (const entry of parsed.entries) {
				this.entries.set(entry.filePath, entry);
			}
		} catch {
			// File doesn't exist yet — start fresh
			this.entries.clear();
		}
		this.loaded = true;
	}

	/**
	 * Ensure the on-disk index has been loaded into memory before mutating.
	 * Safe to call multiple times — subsequent calls are no-ops.
	 */
	async ensureLoaded(): Promise<void> {
		if (!this.loaded) await this.load();
	}

	async save(): Promise<void> {
		if (!this.dirty) return;
		const data: IndexFile = {
			version: INDEX_VERSION,
			entries: Array.from(this.entries.values()),
		};
		// Ensure the parent directory exists before writing (ENOENT on fresh installs)
		const dir = this.indexPath.substring(0, this.indexPath.lastIndexOf("/"));
		if (dir && !(await this.app.vault.adapter.exists(dir))) {
			await this.app.vault.adapter.mkdir(dir);
		}
		await this.app.vault.adapter.write(this.indexPath, JSON.stringify(data));
		this.dirty = false;
	}

	// ── Mutation ──────────────────────────────────────────────────────────────

	upsert(filePath: string, mtime: number, chunks: VectorChunk[]): void {
		this.entries.set(filePath, { filePath, mtime, chunks });
		this.dirty = true;
	}

	remove(filePath: string): void {
		if (this.entries.has(filePath)) {
			this.entries.delete(filePath);
			this.dirty = true;
		}
	}

	/** Returns the stored mtime for a file, or -1 if not indexed. */
	getMtime(filePath: string): number {
		return this.entries.get(filePath)?.mtime ?? -1;
	}

	get size(): number {
		return this.entries.size;
	}

	// ── Search ────────────────────────────────────────────────────────────────

	/** Pure vector search — kept for internal use and testing. */
	search(queryVector: number[], topK: number): Array<{ filePath: string; text: string; score: number }> {
		return this.hybridSearch(queryVector, "", topK, 1.0);
	}

	/**
	 * Hybrid search combining cosine similarity (vector) with BM25 keyword scoring.
	 *
	 * @param queryVector  - Embedding of the query string.
	 * @param queryText    - Raw query string for keyword scoring.
	 * @param topK         - Number of results to return.
	 * @param vectorWeight - 0–1 weight for the vector score (1 - vectorWeight goes to BM25).
	 *                       Defaults to 0.7 (70% semantic, 30% keyword).
	 */
	hybridSearch(
		queryVector: number[],
		queryText: string,
		topK: number,
		vectorWeight = 0.7,
	): Array<{ filePath: string; text: string; score: number }> {
		const keywordWeight = 1 - vectorWeight;
		const terms = tokenize(queryText);

		// Collect all chunks for BM25 corpus statistics
		type ChunkRef = { filePath: string; text: string; tokens: string[] };
		const allChunks: ChunkRef[] = [];
		for (const entry of this.entries.values()) {
			for (const chunk of entry.chunks) {
				allChunks.push({
					filePath: entry.filePath,
					text: chunk.text,
					tokens: tokenize(chunk.text),
				});
			}
		}

		const N = allChunks.length;
		if (N === 0) return [];

		// Precompute IDF for each query term (BM25 IDF formula)
		const idf = new Map<string, number>();
		if (terms.length > 0 && keywordWeight > 0) {
			for (const term of terms) {
				const df = allChunks.filter(c => c.tokens.includes(term)).length;
				idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
			}
		}

		// Average chunk length (in tokens) for BM25 length normalisation
		const avgLen = allChunks.reduce((sum, c) => sum + c.tokens.length, 0) / N;

		const results: Array<{ filePath: string; text: string; score: number }> = [];
		let chunkIdx = 0;

		for (const entry of this.entries.values()) {
			for (const chunk of entry.chunks) {
				const ref = allChunks[chunkIdx++];
				const vecScore = cosineSimilarity(queryVector, chunk.vector);

				let bm25Score = 0;
				if (terms.length > 0 && keywordWeight > 0) {
					bm25Score = bm25(ref.tokens, terms, idf, avgLen);
				}

				// Normalise BM25 into [0, 1] range with a soft cap at 10
				const normBm25 = Math.min(bm25Score / 10, 1);
				const combined = vectorWeight * vecScore + keywordWeight * normBm25;
				results.push({ filePath: entry.filePath, text: chunk.text, score: combined });
			}
		}

		results.sort((a, b) => b.score - a.score);
		return results.slice(0, topK);
	}
}

// ── Utility ───────────────────────────────────────────────────────────────────

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

/**
 * Lowercase, strip punctuation, split on whitespace.
 * Simple but effective for BM25 on natural-language notes.
 */
function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter(t => t.length > 1);
}

/**
 * BM25 score for a single chunk against query terms.
 * k1 = 1.5, b = 0.75 are standard Okapi BM25 parameters.
 */
function bm25(
	chunkTokens: string[],
	queryTerms: string[],
	idf: Map<string, number>,
	avgLen: number,
	k1 = 1.5,
	b = 0.75,
): number {
	const len = chunkTokens.length;
	const tfMap = new Map<string, number>();
	for (const t of chunkTokens) tfMap.set(t, (tfMap.get(t) ?? 0) + 1);

	let score = 0;
	for (const term of queryTerms) {
		const tf = tfMap.get(term) ?? 0;
		if (tf === 0) continue;
		const termIdf = idf.get(term) ?? 0;
		const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (len / avgLen)));
		score += termIdf * tfNorm;
	}
	return score;
}
