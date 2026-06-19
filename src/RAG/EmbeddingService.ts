import OpenAI from "openai";
import { logger } from "../utils/logger";
import { GoogleGenAI } from "@google/genai";

export type EmbeddingProvider = "onnx" | "openai" | "gemini" | "ollama" | "lmStudio";

export interface EmbeddingConfig {
	provider: EmbeddingProvider;
	/** Embedding model name — ignored for "onnx" (model is fixed). */
	model?: string;
	openAIKey?: string;
	geminiKey?: string;
	ollamaHost?: string;
	lmStudioHost?: string;
}

export const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingProvider, string> = {
	onnx: "Xenova/all-mpnet-base-v2",
	openai: "text-embedding-3-small",
	gemini: "text-embedding-004",
	ollama: "nomic-embed-text",
	lmStudio: "nomic-embed-text",
};

// ── Model download config ────────────────────────────────────────────────────

const BASE_URL   = "https://huggingface.co/Xenova/all-mpnet-base-v2/resolve/main";
const MODEL_FILES = [
	"config.json",
	"tokenizer.json",
	"tokenizer_config.json",
	"onnx/model_quantized.onnx",
];
const FILE_SIZES: Record<string, number> = {
	"config.json":               4_000,
	"tokenizer.json":          760_000,
	"tokenizer_config.json":     2_000,
	"onnx/model_quantized.onnx": 110_000_000,
};

// ── Streaming file downloader (handles CSP, redirects, large files) ───────────

function downloadFile(
	url: string,
	destPath: string,
	onBytes?: (downloaded: number, total: number) => void,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const https = require("https") as typeof import("https");
		const http  = require("http")  as typeof import("http");
		const fs    = require("fs")    as typeof import("fs");

		const go = (reqUrl: string) => {
			const u    = new URL(reqUrl);
			const prot = u.protocol === "https:" ? https : http;
			prot.request(
				{ hostname: u.hostname, path: u.pathname + u.search, method: "GET",
				  headers: { "User-Agent": "obsidian-llm-plugin" } },
				(res) => {
					if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
						res.resume();
						const loc = res.headers.location;
						go(loc.startsWith("http") ? loc : new URL(loc, reqUrl).toString());
						return;
					}
					if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} for ${reqUrl}`)); return; }
					const total = parseInt(res.headers["content-length"] ?? "0", 10);
					let done = 0;
					const ws = fs.createWriteStream(destPath);
					res.on("data", (c: Buffer) => { done += c.length; onBytes?.(done, total); });
					res.pipe(ws);
					ws.on("finish", resolve);
					ws.on("error", (e: Error) => { try { fs.unlinkSync(destPath); } catch { /* ignore */ } reject(e); });
					res.on("error", reject);
				},
			).on("error", reject).end();
		};
		go(url);
	});
}

// ── WordPiece tokenizer (inline — no transformers.js dependency) ──────────────

class WordPieceTokenizer {
	private vocab:    Record<string, number>;
	private unkId:    number;
	private prefix:   string;
	private maxChars: number;
	private clsId:    number;
	private sepId:    number;
	private lowercase:    boolean;
	private stripAccents: boolean | null;

	constructor(tokJson: any) {
		const m = tokJson.model;
		this.vocab    = m.vocab;
		this.unkId    = m.vocab[m.unk_token] ?? 3;
		this.prefix   = m.continuing_subword_prefix ?? "##";
		this.maxChars = m.max_input_chars_per_word   ?? 100;
		const pp       = tokJson.post_processor ?? {};
		this.clsId     = (pp.cls ?? ["<s>", 0])[1];
		this.sepId     = (pp.sep ?? ["</s>", 2])[1];
		const norm     = tokJson.normalizer ?? {};
		this.lowercase    = norm.lowercase !== false;
		this.stripAccents = norm.strip_accents;  // null = follow lowercase
	}

	encode(text: string, maxLen = 512): { input_ids: number[]; attention_mask: number[] } {
		// eslint-disable-next-line no-control-regex -- intentionally strips ASCII control chars
		let t = text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").replace(/\s+/g, " ").trim();
		if (this.lowercase) {
			t = t.toLowerCase();
			if (this.stripAccents !== false) t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
		} else if (this.stripAccents === true) {
			t = t.normalize("NFD").replace(/[̀-ͯ]/g, "");
		}

		const words = this.pretokenize(t);
		const ids   = [this.clsId];
		for (const word of words) {
			ids.push(...this.tokenizeWord(word));
			if (ids.length >= maxLen - 1) break;
		}
		if (ids.length >= maxLen) ids.length = maxLen - 1;
		ids.push(this.sepId);
		return { input_ids: ids, attention_mask: ids.map(() => 1) };
	}

	private pretokenize(text: string): string[] {
		const words: string[] = [];
		let cur = "";
		for (const ch of text) {
			const cp = ch.codePointAt(0)!;
			if (this.isWs(cp)) { if (cur) { words.push(cur); cur = ""; } }
			else if (this.isPunct(cp) || this.isCJK(cp)) {
				if (cur) { words.push(cur); cur = ""; }
				words.push(ch);
			} else { cur += ch; }
		}
		if (cur) words.push(cur);
		return words;
	}

	private tokenizeWord(word: string): number[] {
		if (word.length > this.maxChars) return [this.unkId];
		const ids: number[] = [];
		let start = 0;
		while (start < word.length) {
			let end = word.length, found: string | null = null;
			while (start < end) {
				const sub = (start === 0 ? "" : this.prefix) + word.slice(start, end);
				if (sub in this.vocab) { found = sub; break; }
				end--;
			}
			if (!found) return [this.unkId];
			ids.push(this.vocab[found]);
			start = end;
		}
		return ids;
	}

	private isWs(cp: number)    { return cp === 32 || cp === 9 || cp === 10 || cp === 13; }
	private isPunct(cp: number) {
		return (cp >= 33 && cp <= 47) || (cp >= 58 && cp <= 64) ||
		       (cp >= 91 && cp <= 96) || (cp >= 123 && cp <= 126) ||
		       (cp >= 0x2000 && cp <= 0x206F) || (cp >= 0x2E00 && cp <= 0x2E7F);
	}
	private isCJK(cp: number) {
		return (cp >= 0x4E00 && cp <= 0x9FFF) || (cp >= 0x3400 && cp <= 0x4DBF) ||
		       (cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x20000 && cp <= 0x2A6DF);
	}
}

// ── ONNX inference (runs directly in renderer via onnxruntime-node) ───────────

interface OrtLike {
	InferenceSession: {
		create(path: string, opts: any): Promise<any>;
	};
	Tensor: new (type: string, data: any, dims: number[]) => any;
}

async function runInference(
	ort: OrtLike,
	session: any,
	tokenizer: WordPieceTokenizer,
	texts: string[],
): Promise<number[][]> {
	const results: number[][] = [];
	for (const text of texts) {
		const { input_ids, attention_mask } = tokenizer.encode(text, 512);
		const seqLen = input_ids.length;
		const feeds: Record<string, any> = {};

		for (const name of session.inputNames as string[]) {
			if (name === "input_ids") {
				feeds.input_ids = new ort.Tensor("int64",
					BigInt64Array.from(input_ids.map(BigInt)), [1, seqLen]);
			} else if (name === "attention_mask") {
				feeds.attention_mask = new ort.Tensor("int64",
					BigInt64Array.from(attention_mask.map(BigInt)), [1, seqLen]);
			} else if (name === "token_type_ids") {
				feeds.token_type_ids = new ort.Tensor("int64", new BigInt64Array(seqLen), [1, seqLen]);
			} else if (name === "position_ids") {
				feeds.position_ids = new ort.Tensor("int64",
					BigInt64Array.from(Array.from({ length: seqLen }, (_, i) => BigInt(i))), [1, seqLen]);
			}
		}

		const out    = await session.run(feeds);
		const outKey = (session.outputNames as string[]).find(n => n === "last_hidden_state")
		               ?? session.outputNames[0];
		const tensor = out[outKey];
		const dims   = tensor.dims as number[];
		const data   = tensor.data as Float32Array;

		// Mean-pool over sequence (masked), then L2-normalize
		const hiddenSize = dims[dims.length - 1];
		const embedding  = new Float32Array(hiddenSize);

		if (dims.length === 3) {
			let count = 0;
			for (let i = 0; i < seqLen; i++) {
				if (attention_mask[i]) {
					for (let j = 0; j < hiddenSize; j++) embedding[j] += data[i * hiddenSize + j];
					count++;
				}
			}
			if (count > 0) for (let j = 0; j < hiddenSize; j++) embedding[j] /= count;
		} else {
			for (let j = 0; j < hiddenSize; j++) embedding[j] = data[j];
		}

		let norm = 0;
		for (let j = 0; j < hiddenSize; j++) norm += embedding[j] * embedding[j];
		norm = Math.sqrt(norm);
		if (norm > 0) for (let j = 0; j < hiddenSize; j++) embedding[j] /= norm;

		results.push(Array.from(embedding));
	}
	return results;
}

// ── Module-level singletons ───────────────────────────────────────────────────

let _pluginDir:   string | null = null;
let _ort:         OrtLike | null = null;
let _session:     any = null;
let _tokenizer:   WordPieceTokenizer | null = null;
let _loadPromise: Promise<void> | null = null;

export class EmbeddingService {
	constructor(private config: EmbeddingConfig) {}

	// ── Static lifecycle ──────────────────────────────────────────────────────

	static isOnnxLoaded(): boolean { return _session !== null; }

	static configure(pluginDir: string): void {
		_pluginDir = pluginDir;
		logger.log("[RAG] EmbeddingService configured, pluginDir:", pluginDir);
	}

	static async loadOnnx(onProgress?: (pct: number) => void): Promise<void> {
		if (_session) return;
		if (_loadPromise) return _loadPromise;

		_loadPromise = (async () => {
			if (!_pluginDir) throw new Error("[RAG] configure() not called");
			const path = require("path") as typeof import("path");
			const fs   = require("fs")   as typeof import("fs");

			// ── 1. Download model files ───────────────────────────────────
			await EmbeddingService.downloadModelFiles(_pluginDir, pct => onProgress?.(pct * 0.75));

			// ── 2. Load tokenizer ─────────────────────────────────────────
			onProgress?.(76);
			const modelDir = path.join(_pluginDir, "onnx-models", "Xenova", "all-mpnet-base-v2");
			const tokJson  = JSON.parse(fs.readFileSync(path.join(modelDir, "tokenizer.json"), "utf8"));
			_tokenizer = new WordPieceTokenizer(tokJson);
			logger.log("[RAG] Tokenizer loaded");

			// ── 3. Load onnxruntime-node (same require that works in the banner) ──
			onProgress?.(80);
			// Prefer the banner-injected instance (already required, no double-load)
			const ortSymbol = Symbol.for("onnxruntime");
			if ((globalThis as any)[ortSymbol]) {
				_ort = (globalThis as any)[ortSymbol] as OrtLike;
				logger.log("[RAG] Using banner-injected onnxruntime-node");
			} else {
				// Derive ORT path from the plugin's own location
				// _pluginDir = .../large-language-models  → ../Obsidian-LLM-Plugin/node_modules/onnxruntime-node
				// We embed the absolute path at build time via __ORT_ABS_PATH__ below.
				_ort = require("__ORT_ABS_PATH__") as OrtLike;
				logger.log("[RAG] Loaded onnxruntime-node directly");
			}

			// ── 4. Create inference session ───────────────────────────────
			onProgress?.(85);
			const onnxPath = path.join(modelDir, "onnx", "model_quantized.onnx");
			logger.log("[RAG] Creating InferenceSession from", onnxPath);
			_session = await _ort.InferenceSession.create(onnxPath, {
				executionProviders: ["cpu"],
			});
			logger.log("[RAG] Session ready. Inputs:", _session.inputNames, "Outputs:", _session.outputNames);
			onProgress?.(100);
		})().catch(e => { _loadPromise = null; throw e; });

		return _loadPromise;
	}

	static async downloadModelFiles(
		pluginDir: string,
		onProgress?: (pct: number) => void,
	): Promise<void> {
		const path = require("path") as typeof import("path");
		const fs   = require("fs")   as typeof import("fs");

		const modelDir = path.join(pluginDir, "onnx-models", "Xenova", "all-mpnet-base-v2");
		fs.mkdirSync(path.join(modelDir, "onnx"), { recursive: true });

		const totalEstimated = Object.values(FILE_SIZES).reduce((a, b) => a + b, 0);
		let completedBytes = 0;

		for (const file of MODEL_FILES) {
			const dest = path.join(modelDir, file);
			if (fs.existsSync(dest)) {
				completedBytes += FILE_SIZES[file] ?? 0;
				onProgress?.((completedBytes / totalEstimated) * 100);
				logger.log("[RAG] Already cached:", file);
				continue;
			}
			const url = `${BASE_URL}/${file}`;
			logger.log("[RAG] Downloading:", file);
			const est  = FILE_SIZES[file] ?? 0;
			const base = completedBytes;
			await downloadFile(url, dest, (dl, total) => {
				const eff     = total > 0 ? total : est;
				const overall = base + (dl / eff) * est;
				onProgress?.((overall / totalEstimated) * 100);
			});
			completedBytes += est;
			onProgress?.((completedBytes / totalEstimated) * 100);
			logger.log("[RAG] Downloaded:", file);
		}
	}

	static unload(): void {
		_session = null; _ort = null; _tokenizer = null; _loadPromise = null;
	}

	static getInstance(): EmbeddingService {
		return new EmbeddingService({ provider: "onnx" });
	}

	// ── Public interface ──────────────────────────────────────────────────────

	isLoaded(): boolean {
		return this.config.provider === "onnx" ? EmbeddingService.isOnnxLoaded() : true;
	}

	async embed(text: string): Promise<number[]> {
		return (await this.embedBatch([text]))[0];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const { provider, model } = this.config;
		const m = model ?? DEFAULT_EMBEDDING_MODELS[provider];
		switch (provider) {
			case "onnx":     return this.embedOnnx(texts);
			case "openai":   return this.embedBatchOpenAI(texts, m);
			case "gemini":   return this.embedBatchGemini(texts, m);
			case "ollama":   return this.embedBatchOllama(texts, m);
			case "lmStudio": return this.embedBatchLMStudio(texts, m);
			default: throw new Error(`[RAG] Unknown provider: ${provider}`);
		}
	}

	async checkOllamaModel(): Promise<boolean> {
		if (this.config.provider !== "ollama") return true;
		const host  = this.config.ollamaHost ?? "http://localhost:11434";
		const model = this.config.model ?? DEFAULT_EMBEDDING_MODELS["ollama"];
		try {
			const res = await fetch(`${host}/api/tags`);
			if (!res.ok) return false;
			const data = await res.json();
			const pulled    = (data.models ?? []).map((m: any) => m.name.split(":")[0]);
			const modelBase = model.split(":")[0];
			if (!pulled.includes(modelBase)) throw new OllamaModelNotFoundError(model, host);
			return true;
		} catch (e) {
			if (e instanceof OllamaModelNotFoundError) throw e;
			return false;
		}
	}

	// ── ONNX ─────────────────────────────────────────────────────────────────

	private async embedOnnx(texts: string[]): Promise<number[][]> {
		if (!_session || !_tokenizer || !_ort) {
			throw new Error("[RAG] ONNX not loaded — call EmbeddingService.loadOnnx() first");
		}
		return runInference(_ort, _session, _tokenizer, texts);
	}

	// ── OpenAI ───────────────────────────────────────────────────────────────

	private async embedBatchOpenAI(texts: string[], model: string): Promise<number[][]> {
		const key = this.config.openAIKey;
		if (!key) throw new Error("[RAG] OpenAI API key not set");
		const client   = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });
		const response = await client.embeddings.create({ model, input: texts });
		return response.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
	}

	// ── Gemini ───────────────────────────────────────────────────────────────

	private async embedBatchGemini(texts: string[], model: string): Promise<number[][]> {
		const key = this.config.geminiKey;
		if (!key) throw new Error("[RAG] Gemini API key not set");
		const client = new GoogleGenAI({ apiKey: key });
		const results: number[][] = [];
		for (const text of texts) {
			const r = await client.models.embedContent({ model, contents: text });
			const v = r.embeddings?.[0]?.values;
			if (!v) throw new Error("[RAG] Gemini returned no embedding");
			results.push(v);
		}
		return results;
	}

	// ── Ollama ───────────────────────────────────────────────────────────────

	private async embedBatchOllama(texts: string[], model: string): Promise<number[][]> {
		const host   = this.config.ollamaHost ?? "http://localhost:11434";
		const client = new OpenAI({ apiKey: "ollama", baseURL: `${host}/v1`, dangerouslyAllowBrowser: true });
		try {
			const r = await client.embeddings.create({ model, input: texts });
			return r.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
		} catch (e: any) {
			const msg = e?.message ?? String(e);
			if (msg.includes("404") || (msg.toLowerCase().includes("model") && msg.toLowerCase().includes("not found"))) {
				throw new OllamaModelNotFoundError(model, host);
			}
			throw e;
		}
	}

	// ── LM Studio ────────────────────────────────────────────────────────────

	private async embedBatchLMStudio(texts: string[], model: string): Promise<number[][]> {
		const host   = this.config.lmStudioHost ?? "http://localhost:1234";
		const client = new OpenAI({ apiKey: "lm-studio", baseURL: `${host}/v1`, dangerouslyAllowBrowser: true });
		const results: number[][] = [];
		for (const text of texts) {
			const r = await client.embeddings.create({ model, input: text, encoding_format: "float" });
			const emb = r.data[0]?.embedding;
			if (!emb || emb.length === 0) throw new Error("[RAG] LM Studio returned no embedding");
			results.push(emb);
		}
		return results;
	}
}

export class OllamaModelNotFoundError extends Error {
	constructor(public model: string, public host: string) {
		super(`[RAG] Ollama model "${model}" is not available at ${host}. Pull it first: ollama pull ${model}`);
		this.name = "OllamaModelNotFoundError";
	}
}
