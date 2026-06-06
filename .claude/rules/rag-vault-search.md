---
paths:
  - "src/RAG/**"
---

# RAG / Vault Search

Three classes in `src/RAG/`:

- **`VectorStore.ts`** — embeddings in a flat JSON file; cosine search + incremental updates (mtime skip). `save()` mkdir-guards the parent dir (always `vault.adapter.mkdir()` before `adapter.write()` to plugin-relative paths). **Always call `store.ensureLoaded()` before `upsert()`/`save()` outside `indexVault()`** — otherwise a partial in-memory state overwrites the full on-disk index (`VaultIndexer.indexFile()` does this).
- **`EmbeddingService.ts`** — provider-agnostic embeddings: OpenAI (`text-embedding-3-small`), Gemini (`text-embedding-004`), Ollama, LM Studio (OpenAI-compatible `/v1/embeddings`; LM Studio requires explicit `encoding_format: "float"`). Reuses existing keys/hosts from settings.
- **`VaultIndexer.ts`** — chunked indexing (~1500 chars/paragraph chunk with path + heading prefix); `semanticSearch(query, topK)` returns a markdown context block. Calls `EmbeddingService.checkOllamaModel()` before indexing to surface a pull-command error.

Integration:
- `LLMPlugin.vaultIndexer` singleton; call `plugin.initVaultIndexer()` after RAG setting changes. Vault `modify` (debounced 2 s) / `delete` / `rename` events keep the index current.
- `ObsidianToolRegistry` exposes `search_vault_semantic` (`risk: "safe"`) to tool-capable models via `AgentLoop`.
- Targeted write tools (prefer over `obsidian_modify_note` for partial edits): `obsidian_insert_after_heading` (errors if heading missing) and `obsidian_patch_note` (exact find/replace; errors if absent or non-unique — model should widen `old_string`).
- `AgentLoop` fires `AgentCallbacks.onToolResult(toolName, input, result)` after each successful tool execution — `ChatContainer` uses it for the cited-sources panel and `pendingToolCalls` recording.
- `ChatContainer.useVaultSearch` toggle pre-fills `pendingContextString` with top-k results (manual fallback for models with weak tool-calling). After generation a collapsible Sources panel (`<details class="llm-rag-sources">`) lists contributing files.
- **Hybrid scoring**: 70% cosine + 30% BM25 (IDF computed at search time). `VectorStore.hybridSearch()` does both; `search()` delegates with full vector weight.
- Settings: `plugin.settings.ragSettings` (`RAGSettings`), configured in LLMSettingsModal → Vault Search.
