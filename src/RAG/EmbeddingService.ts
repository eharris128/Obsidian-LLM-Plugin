import { pipeline, FeatureExtractionPipeline } from "@huggingface/transformers";
import OpenAI from "openai";
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
	onnx: "Xenova/nomic-embed-text-v1.5",
	openai: "text-embedding-3-small",
	gemini: "text-embedding-004",
	ollama: "nomic-embed-text",
	lmStudio: "nomic-embed-text",
};

// ── ONNX singleton state ──────────────────────────────────────────────────────

let onnxPipe: FeatureExtractionPipeline | null = null;
let onnxLoadPromise: Promise<void> | null = null;

export class EmbeddingService {
	constructor(private config: EmbeddingConfig) {}

	// ── Static helpers for ONNX lifecycle ────────────────────────────────────

	static isOnnxLoaded(): boolean {
		return onnxPipe !== null;
	}

	static async loadOnnx(onProgress?: (progress: number) => void): Promise<void> {
		if (onnxPipe) return;
		if (onnxLoadPromise) return onnxLoadPromise;
		onnxLoadPromise = (async () => {
			onnxPipe = await pipeline("feature-extraction", "Xenova/nomic-embed-text-v1.5", {
				dtype: "q8" as any,
				progress_callback: onProgress
					? (p: any) => onProgress(p.progress ?? 0)
					: undefined,
			}) as FeatureExtractionPipeline;
		})();
		return onnxLoadPromise;
	}

	/** Convenience factory — returns a pre-configured instance for the ONNX provider. */
	static getInstance(): EmbeddingService {
		return new EmbeddingService({ provider: "onnx" });
	}

	// ── Public interface ──────────────────────────────────────────────────────

	isLoaded(): boolean {
		if (this.config.provider === "onnx") return EmbeddingService.isOnnxLoaded();
		return true; // external providers are always "ready" (no pre-load step)
	}

	async embed(text: string): Promise<number[]> {
		return (await this.embedBatch([text]))[0];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		const { provider, model } = this.config;
		const resolvedModel = model ?? DEFAULT_EMBEDDING_MODELS[provider];

		switch (provider) {
			case "onnx":
				return this.embedOnnx(texts);
			case "openai":
				return this.embedBatchOpenAI(texts, resolvedModel);
			case "gemini":
				return this.embedBatchGemini(texts, resolvedModel);
			case "ollama":
				return this.embedBatchOllama(texts, resolvedModel);
			case "lmStudio":
				return this.embedBatchLMStudio(texts, resolvedModel);
			default:
				throw new Error(`[RAG] Unknown embedding provider: ${provider}`);
		}
	}

	async checkOllamaModel(): Promise<boolean> {
		if (this.config.provider !== "ollama") return true;
		const host = this.config.ollamaHost ?? "http://localhost:11434";
		const model = this.config.model ?? DEFAULT_EMBEDDING_MODELS["ollama"];
		try {
			const res = await fetch(`${host}/api/tags`);
			if (!res.ok) return false;
			const data = await res.json();
			const pulled = (data.models ?? []).map((m: any) => m.name.split(":")[0]);
			const modelBase = model.split(":")[0];
			if (!pulled.includes(modelBase)) {
				throw new OllamaModelNotFoundError(model, host);
			}
			return true;
		} catch (e) {
			if (e instanceof OllamaModelNotFoundError) throw e;
			return false;
		}
	}

	// ── ONNX ─────────────────────────────────────────────────────────────────

	private async embedOnnx(texts: string[]): Promise<number[][]> {
		if (!onnxPipe) throw new Error("[RAG] ONNX model not loaded — call EmbeddingService.loadOnnx() first");
		const output = await onnxPipe(texts, { pooling: "mean", normalize: true });
		return Array.from({ length: texts.length }, (_, i) =>
			Array.from((output as any)[i].data as Float32Array)
		);
	}

	// ── OpenAI ───────────────────────────────────────────────────────────────

	private async embedBatchOpenAI(texts: string[], model: string): Promise<number[][]> {
		const key = this.config.openAIKey;
		if (!key) throw new Error("[RAG] OpenAI API key not set");
		const client = new OpenAI({ apiKey: key, dangerouslyAllowBrowser: true });
		const response = await client.embeddings.create({ model, input: texts });
		return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
	}

	// ── Gemini ───────────────────────────────────────────────────────────────

	private async embedBatchGemini(texts: string[], model: string): Promise<number[][]> {
		const key = this.config.geminiKey;
		if (!key) throw new Error("[RAG] Gemini API key not set");
		const client = new GoogleGenAI({ apiKey: key });
		const results: number[][] = [];
		for (const text of texts) {
			const response = await client.models.embedContent({ model, contents: text });
			const values = response.embeddings?.[0]?.values;
			if (!values) throw new Error("[RAG] Gemini returned no embedding");
			results.push(values);
		}
		return results;
	}

	// ── Ollama ───────────────────────────────────────────────────────────────

	private async embedBatchOllama(texts: string[], model: string): Promise<number[][]> {
		const host = this.config.ollamaHost ?? "http://localhost:11434";
		const client = new OpenAI({
			apiKey: "ollama",
			baseURL: `${host}/v1`,
			dangerouslyAllowBrowser: true,
		});
		try {
			const response = await client.embeddings.create({ model, input: texts });
			return response.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
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
		const host = this.config.lmStudioHost ?? "http://localhost:1234";
		const client = new OpenAI({
			apiKey: "lm-studio",
			baseURL: `${host}/v1`,
			dangerouslyAllowBrowser: true,
		});
		const results: number[][] = [];
		for (const text of texts) {
			const response = await client.embeddings.create({
				model,
				input: text,
				encoding_format: "float",
			});
			const embedding = response.data[0]?.embedding;
			if (!embedding || embedding.length === 0) {
				throw new Error("[RAG] LM Studio returned no embedding — ensure an embedding model is loaded");
			}
			results.push(embedding);
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
