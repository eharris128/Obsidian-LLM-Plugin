import { pipeline, FeatureExtractionPipeline } from "@huggingface/transformers";

export type EmbeddingVector = number[];

export class EmbeddingService {
	private static instance: EmbeddingService | null = null;
	private pipe: FeatureExtractionPipeline | null = null;
	private readonly modelId = "Xenova/nomic-embed-text-v1.5";
	private loadPromise: Promise<void> | null = null;

	static getInstance(): EmbeddingService {
		if (!EmbeddingService.instance) {
			EmbeddingService.instance = new EmbeddingService();
		}
		return EmbeddingService.instance;
	}

	async load(onProgress?: (progress: number) => void): Promise<void> {
		if (this.pipe) return;
		if (this.loadPromise) return this.loadPromise;
		this.loadPromise = (async () => {
			this.pipe = await pipeline("feature-extraction", this.modelId, {
				dtype: "q8" as any,
				progress_callback: onProgress
					? (p: any) => onProgress(p.progress ?? 0)
					: undefined,
			}) as FeatureExtractionPipeline;
		})();
		return this.loadPromise;
	}

	isLoaded(): boolean {
		return this.pipe !== null;
	}

	async embed(text: string): Promise<EmbeddingVector> {
		return (await this.embedBatch([text]))[0];
	}

	async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
		if (!this.pipe) throw new Error("[RAG] EmbeddingService not loaded — call load() first");
		const output = await this.pipe(texts, { pooling: "mean", normalize: true });
		return Array.from({ length: texts.length }, (_, i) =>
			Array.from((output as any)[i].data as Float32Array)
		);
	}

	async checkOllamaModel(): Promise<boolean> {
		// No-op: ONNX runs in-process, no server check needed
		return true;
	}
}
