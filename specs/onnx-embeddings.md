# Spec: ONNX Local Embeddings (Replace Ollama Dependency)

## Context & Problem

The plugin already has a working RAG/embeddings system (visible in `main.js` and `rag-index.json`), but **its TypeScript source files are missing from `src/`** — they were never committed to git. The compiled `main.js` contains functions like `extractRagSourcePaths`, `formatRagResultsAsContext`, `registerRagVaultEvents`, etc., and `rag-index.json` contains 24 vault files indexed as 768-dim vectors using `nomic-embed-text` via Ollama.

**The core problem with the current approach:** it requires Ollama to be running as a separate background server. If Ollama isn't running, embeddings silently fail. The ONNX approach runs a quantized embedding model entirely inside the plugin process — no external server needed.

## Goal

Replace the Ollama embedding dependency with an in-process ONNX model via `@huggingface/transformers` (Transformers.js). The rest of the RAG pipeline (chunking, indexing, cosine similarity retrieval, context injection) should remain structurally intact.

## Recommended Model

**`Xenova/nomic-embed-text-v1.5`** — quantized ONNX version of nomic-embed-text.
- 768-dim output (drop-in compatible with existing `rag-index.json` vectors)
- ~90MB download cached to disk on first use
- Fully offline after first run
- Used successfully in other Obsidian plugins (Smart Connections)

Fallback option: `Xenova/all-MiniLM-L6-v2` (384-dim, ~25MB) if bundle size is a concern — but requires re-indexing since dimension changes.

## Implementation Steps

### 1. Add dependency

```bash
npm install @huggingface/transformers
```

Add to `esbuild.config.mjs` externals if needed; `@huggingface/transformers` should bundle fine with esbuild targeting CommonJS.

### 2. Create `src/services/EmbeddingService.ts`

```typescript
import { pipeline, FeatureExtractionPipeline } from "@huggingface/transformers";

export type EmbeddingVector = number[];

export class EmbeddingService {
  private static instance: EmbeddingService | null = null;
  private pipe: FeatureExtractionPipeline | null = null;
  private modelId = "Xenova/nomic-embed-text-v1.5";
  private loading = false;
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
      this.loading = true;
      this.pipe = await pipeline("feature-extraction", this.modelId, {
        quantized: true,
        progress_callback: onProgress
          ? (p: any) => onProgress(p.progress ?? 0)
          : undefined,
      });
      this.loading = false;
    })();
    return this.loadPromise;
  }

  isLoaded(): boolean {
    return this.pipe !== null;
  }

  async embed(texts: string[]): Promise<EmbeddingVector[]> {
    if (!this.pipe) throw new Error("EmbeddingService not loaded");
    const output = await this.pipe(texts, { pooling: "mean", normalize: true });
    return Array.from({ length: texts.length }, (_, i) =>
      Array.from(output[i].data as Float32Array)
    );
  }

  async embedOne(text: string): Promise<EmbeddingVector> {
    const results = await this.embed([text]);
    return results[0];
  }

  cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
  }
}
```

### 3. Update `src/services/RagService.ts` (recover or rewrite)

The source for `RagService` is missing. Reconstruct it based on what's visible in `main.js`. Key responsibilities:

**Indexing:**
- Walk vault files (respect `ragSettings.excludedFolders`)
- Split each file into overlapping chunks (~500 tokens, 50-token overlap)
- Call `EmbeddingService.embed()` on each chunk (batch in groups of 32)
- Store results as `{ filePath, mtime, chunks: [{ text, vector }] }` in `rag-index.json`
- Skip files whose `mtime` hasn't changed since last index (incremental update)

**Retrieval:**
- Accept a query string
- Embed it with `EmbeddingService.embedOne(query)`
- Score all chunks with cosine similarity
- Return top-K chunks (default `ragSettings.topK = 5`), deduplicated by file

**Context formatting:**
- Format retrieved chunks as a `## Vault Context` block prepended to the system prompt
- Include source file path for each chunk

**Vault event registration:**
- Watch `vault.on('modify')` and `vault.on('delete')` to update index incrementally (debounced 2s)

### 4. Update Settings UI (`src/Settings/SettingsView.ts`)

Replace the Ollama embedding provider dropdown with a single ONNX toggle. Remove `embeddingProvider` and `embeddingModel` settings (no longer user-configurable). Add:

- **Enable Embeddings** toggle — triggers model download on first enable, shows progress bar
- **Re-index Vault** button — clears and rebuilds full index
- **Excluded Folders** — path list to skip during indexing
- **Top K Results** — number of chunks to inject (default 5)
- Model download status indicator (e.g., "Model ready" / "Downloading… 43%")

### 5. Update `src/Types/types.ts`

```typescript
export interface RagSettings {
  enabled: boolean;
  excludedFolders: string[];
  topK: number;
  lastIndexed: number | null;
  indexedFileCount: number;
  modelCached: boolean; // new: tracks whether ONNX model is on disk
}
```

Remove `embeddingProvider` and `embeddingModel` fields.

### 6. Wire into `src/main.ts`

```typescript
// On plugin load, if rag enabled and model cached, warm up EmbeddingService
if (settings.ragSettings.enabled && settings.ragSettings.modelCached) {
  EmbeddingService.getInstance().load();
}
```

### 7. Wire into `src/Plugin/Components/ChatContainer.ts`

Before each API call, if RAG is enabled and model is loaded:

```typescript
const ragContext = await RagService.getInstance().retrieve(userMessage);
if (ragContext) {
  systemPrompt = ragContext + "\n\n" + systemPrompt;
}
```

## Migration

- Existing `rag-index.json` vectors (768-dim from nomic-embed-text) are **compatible** with `nomic-embed-text-v1.5` ONNX — no re-index required on first upgrade.
- If user was previously using a different Ollama model (non-768-dim), detect dimension mismatch on load and prompt re-index.

## Bundle Size Considerations

`@huggingface/transformers` with a quantized model will increase bundle size. The ONNX model files (~90MB) are downloaded and cached to disk (Obsidian's plugin data directory) on first use — they are **not** bundled into `main.js`. Esbuild should handle the JS portion of `@huggingface/transformers` without issues (~500KB minified).

If Electron's Node.js environment causes issues with WASM loading, use the `env.backends.onnx.wasm.wasmPaths` config to point at CDN-hosted WASM, or bundle the WASM files explicitly.

## What to Recover from `main.js`

Before writing new code, search `main.js` for these function names and extract the logic as a starting point:

- `extractRagSourcePaths`
- `formatRagResultsAsContext`
- `ragContext`
- `ragEnabled`
- `ragResults`
- `registerRagVaultEvents`
- `ragDebounceTimers`
- `pendingRagSources`

These implementations already handle edge cases specific to this codebase and should be the base for recovery, not a rewrite from scratch.

## Acceptance Criteria

1. With Ollama **not running**, embeddings index and retrieval still work
2. First enable triggers model download with visible progress
3. Subsequent loads are instant (model cached to disk)
4. Vault queries return semantically relevant chunks, not just keyword matches
5. Existing `rag-index.json` loads without re-indexing (dimension check passes)
6. Incremental index update fires on file save (debounced)
7. TypeScript source for the full RAG feature is committed to `src/`
