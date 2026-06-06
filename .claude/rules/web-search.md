---
paths:
  - "src/WebSearch/**"
---

# Web Search (SearXNG)

Self-hosted SearXNG instance behind `searxngSettings.enabled`; exposes a `web_search` tool to tool-capable models.

**`src/WebSearch/SearxngService.ts`**: `search(query, numResults?)` (uses `throw: false`; converts 429/403/5xx to descriptive `SearxngHttpError` with `.status`; browser-like UA/Accept headers to dodge bot detection), `checkHealth()` (probes `/healthz`, falls back to a minimal search; returns `true` on 429 — instance up, just rate-limited), static `formatResults()` (renders `**N. [Title](URL)**` markdown so the model reproduces clickable citations).

**Settings** (`searxngSettings`, deep-merged): `enabled` (toggling calls `plugin.initSearxngService()`), `host` (default `http://localhost:8080`), `maxResults` (1–10, default 5). `LLMPlugin.searxngService` is null when disabled/blank host.

**Tool integration**: `web_search` in `ALL_TOOL_DEFINITIONS` with `requiresWebSearch: true` (Settings → Tools shows a warning when SearXNG is off). The executor try/catches and returns error text to the model — never throws. `AgentLoop` takes `searxngService` as its 11th constructor arg, forwards it to `ObsidianToolRegistry` (4th arg); `runAgentMode` passes `this.plugin.searxngService`.

**Web sources panel**: `ChatContainer` regex-parses `**N. [Title](URL)**` links from the tool result into `pendingWebSources`; `appendWebSourcesPanel()` renders a collapsible `<details class="llm-web-sources">` panel (same pattern as RAG sources). Cleared in `newChat()` and on error.

**Settings UI**: "Web Search" group under Settings → Obsidian Agent (visible only when agent enabled): enable toggle, host + Test connection button, max-results slider.

**Common setup issue**: the official SearXNG Docker image needs `server.limiter: false` (default true → 429 for non-browser clients) and `json` added under `search.formats` (default omits it → 403) in the host-mounted `settings.yml`, then `docker restart searxng`.
