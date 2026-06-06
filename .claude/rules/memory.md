---
paths:
  - "src/Memory/**"
---

# Memory System

Cross-session memories as plain markdown files in the vault.

**Hierarchy**: `<rootVaultFolder>/Memories/<uuid>.md` (global, always recalled); `Assistants/<name>/memories/` (when assistant active); `Projects/<name>/memories/` (when project active).

**File format**: frontmatter `created` (ISO), `source` (`"global"` | assistant | project name), `type` (`"fact" | "preference" | "context"`); body = one-sentence memory.

**`src/Memory/MemoryService.ts`**: `extractAndSave(messages, scope, scopeName, callModel)` (model call with structured JSON prompt; skips duplicates at cosine ≥ 0.92), `recall(query, ctx, topK, indexer)` (VaultIndexer hybrid search restricted to active scope folders; deduped by filePath; block prepended to `pendingContextString`), `isMemoryFile(path)`, `loadMemoriesFromFolder(folder)` (adapter-based, bypasses TFile cache).

Extraction is provider-agnostic — `ChatContainer.buildMemoryCallModel()` builds the wrapper for the active provider. A `llm-memory-panel` indicator appears when memories were injected.

**Settings** (`memorySettings`, deep-merged): `enabled` (requires RAG for recall), `extractionTrigger: "end-of-chat" | "manual"`, `recallTopK`. `recallAlways` is **deprecated/unused** — `useMemory` is always `true` when enabled (no toggle chip; kept in the type for backward compat). Per-conversation opt-out exists via the `+` menu.

**/remember command**: `/remember [content]` saves verbatim as a `fact` memory, no model call; intercepted in `handleGenerateClick` before skill resolution. Also in the `+` menu ("Save a memory…", memory-enabled only). Duplicate check still applies.

**ChatContainer hooks**: `extractMemories()` (toolbar button or auto at `newChat()` with `"end-of-chat"` trigger), `appendMemoryIndicator(container)`, `buildMemoryCallModel()`.

**RAG dependency**: recall needs `plugin.vaultIndexer` non-null. Memory files are indexed by the existing vault `modify` watcher. `plugin.initMemoryService()` rebuilds with RAG's `EmbeddingService` config.
