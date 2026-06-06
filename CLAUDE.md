# CLAUDE.md

Guidance for Claude Code when working in this repository — an Obsidian plugin providing LLM chat interfaces for OpenAI, Anthropic Claude, Google Gemini, Mistral, and local Ollama / LM Studio / GPT4All.

## Build Commands

```bash
npm run dev      # watch mode (esbuild)
npm run build    # production build (tsc type-check + esbuild bundle)
npm run version  # bump manifest.json and versions.json
```

Output bundles to `main.js` in the root. esbuild targets CommonJS/ES2018; `obsidian`, `electron`, `@codemirror/*`, and Node builtins are external; SVGs load inline. TypeScript uses strict null checks, baseUrl `src`.

## Architecture Overview

### Entry point

`src/main.ts` — `LLMPlugin` class: initializes platform abstractions (Desktop/Mobile in `src/services/`), loads settings (`loadData`/`saveData`), registers commands/views, initializes MessageStore, History, Assistants, and FAB.

### View architecture (four UIs, shared components)

- **Modal** — `src/Plugin/Modal/ChatModal2.ts`
- **Widget** (tab view) — `src/Plugin/Widget/Widget.ts`
- **FAB** — `src/Plugin/FAB/FAB.ts`
- **StatusBarButton** — `src/Plugin/StatusBar/StatusBarButton.ts` — "Ask AI" popover; uses `viewType: "floating-action-button"` and shares `fabSettings` with the FAB. The popover is built once on `generate()`, so call `chatContainer.syncModelDropdown()` whenever it is shown.

All compose shared components from `src/Plugin/Components/`: `Header.ts` (tab nav), `ChatContainer.ts` (messages, input, API calls), `HistoryContainer.ts`, `SettingsContainer.ts`, `AssistantsContainer.ts` (OpenAI assistants).

### Multiple chat widget tabs

Multiple `WidgetView` instances can be open at once, each owning its own `ChatContainer` + `MessageStore` + chat file path (fully isolated conversations).

- `new-chat-widget` command always creates a fresh tab; `open-LLM-widget-tab` and the ribbon icon use focus-or-open-one-tab.
- `LLMPlugin.lastFocusedWidgetLeaf` is updated on `active-leaf-change`; `openChatFileInWidget()` / `activateTab()` prefer it so "open chat file" lands in the last-used widget.
- `ChatsSidebar.onOpenFile` callback: `WidgetView.onOpen()` sets it to `this.loadChatFile` so sidebar rows load into *that* widget. The standalone `ChatsView` still routes via `plugin.openChatFileInWidget()`.
- **Known limitation:** all widget tabs share `plugin.settings.widgetSettings`; model changes don't push reactively to other tabs' dropdowns. v2: per-view `ViewSettings` clone.

### State management

- **MessageStore** (`src/Plugin/Components/MessageStore.ts`) — pub/sub message state; synchronizes views. `setMessages` stores a shallow copy (`[...messages]`) so later `addMessage` pushes can't mutate the caller's array (notably legacy `promptHistory[n].messages`).
- **HistoryHandler** (`src/History/HistoryHandler.ts`) — legacy in-settings history; superseded by file-based `ChatHistory` when `chatHistoryEnabled: true` (the default).
- **AssistantHandler** (`src/Assistants/AssistantHandler.ts`) — OpenAI assistants state.

### Message flow

Input → `handleGenerateClick()` → message added to MessageStore (notifies subscribers) → provider API call → streaming UI updates → saved to History.

#### Render generation guard (`renderGeneration`) — do not remove

`updateMessages` re-renders the full list via `resetChat()` + async `generateIMLikeMessages()`. A stale async render can append into a container already cleared by a newer render (duplicated/out-of-order messages). `ChatContainer.renderGeneration` counter prevents this: `updateMessages` increments it and passes it down; the render function bails whenever `gen !== this.renderGeneration`. The race only shows up on rapid successive sends — easy to miss in manual testing. Never remove this guard or make `generateIMLikeMessages` synchronous without understanding it.

### Stop button / generation abort

`ChatContainer._abortController: AbortController | null` is non-null while a generation is in-flight.

- `enterStopMode(sendButton)` creates the controller and swaps send → red `square` stop icon (`.llm-stop-mode`); `exitStopMode(sendButton)` clears and restores. Called by `handleGenerateClick` at every entry/exit point (including `/remember` early return and pure-prompt skill path).
- Send button onClick and Enter keydown both check `_abortController` first — if set, they `.abort()` instead of starting a new generation.
- Provider streaming `for await` loops check `signal.aborted` and break; the Anthropic non-agent path also wires `signal.addEventListener("abort", () => stream.abort())`.
- `AgentLoop.runAnthropic` / `runOpenAICompatible` accept an optional `signal?: AbortSignal` 4th param; `runAgentMode` passes the controller's signal.
- `handleGenerateClick`'s catch treats `error.name === "AbortError"` as a graceful stop: partial `previewText` is rendered and saved to history.

### Scan-button context locking (`activeFileForChip`)

`ChatContainer.activeFileForChip: { name, path } | null` stores the file path when the scan button is activated and holds it for the conversation. Two invariants:

1. **Send time reads the stored path, not `getActiveFile()`** — the `useActiveFileContext` block resolves via `activeFileForChip.path` (falls back to `getActiveFile()` only when no chip). Don't revert to a bare `getActiveFile()` call or tab-switching mid-task silently swaps context.
2. **`refreshActiveFileChip()` is a no-op mid-conversation** — guards on `getMessages().length > 0`. The chip only auto-updates when the chat is empty or after `newChat()`.

### API integration

- `openai` SDK — OpenAI chat/images/assistants; also Mistral (`https://api.mistral.ai/v1`), Ollama (`http://localhost:11434/v1`, models via `/api/tags`), LM Studio (`http://localhost:1234/v1`, models via `/v1/models`, placeholder key `"lm-studio"`).
- `@anthropic-ai/sdk` — Claude + Claude Code (agent SDK).
- `@google/generative-ai` — Gemini.
- GPT4All — local server on port 4891.

## Known Pitfalls

### `view.addAction()` survives hot-reloads — always scrub before adding

`addAction()` appends to a persistent DOM element that survives plugin hot-reloads, while any "already added?" tracking variable resets on every load — so naive re-adding duplicates the button. Before calling `addAction()` for any button with a custom class, query the view's container for that class and `.remove()` any existing element, then `addAction()` and `btn.addClass(...)`. The custom class is load-bearing — never skip it.

### Chat-row three-dot context menu — shared helper

`src/Plugin/Components/ChatRowMenuHelper.ts` exports `attachChatRowMenu(itemSelf, flairOuter, file, plugin, onRefresh)` and `RenameModal`, used by both `ChatsView` and `ChatsSidebar`. Call it once per row right after creating `flairOuter`; it appends a hover-revealed `.llm-chats-row-menu-btn`.

"Open in" dispatch methods on `LLMPlugin`: `openChatFileInWidget(path)`, `openChatFileInSidebar(path)`, `openChatFileInFAB(path)` (→ `fab.openAtHistoryFile`), `openChatFileInPopover(path)` (→ `statusBarButton.openAtHistoryFile`). `FAB.openAtHistoryFile()` relies on private DOM refs assigned in `generateFAB()` and cleared in `removeFab()`.

**FAB settings indexing:** always use `getSettingType("floating-action-button") as "fabSettings"` for a typed `LLMPluginSettings` key — never the raw string as an index (TS7053).

### `MarkdownRenderer.render` — use `this`, not `this.plugin`

`ChatContainer extends Component`. Pass `this` as the 5th `Component` argument to `MarkdownRenderer.render()`, never `this.plugin` — the plugin's lifecycle is the whole session, so rendered children never get cleaned up and Obsidian's automated review flags it. `ChatContainer` calls `this.load()` in its constructor and `this.unload()` in `destroy()`.

### Slash menu scoping

`ChatContainer.slashMenuEl` (floating menu on `document.body`, `position: fixed`) is an instance variable so each container removes only its own menu. Do NOT `document.querySelectorAll(".llm-slash-menu").forEach(el => el.remove())` — that destroys other views' menus. Cleaned up in `destroy()`.

## Obsidian Core Styling — Use Native Before Custom

Always prefer Obsidian's built-in components and CSS classes; native gets theming, accessibility, and hover/focus states for free.

| Need | Use |
|------|-----|
| Search box | `SearchComponent` (`search-input-container`) |
| Icon-only button | `ExtraButtonComponent` (`clickable-icon`) |
| Standard button | `ButtonComponent` |
| Sidebar toolbar | `nav-header`, `nav-buttons-container`, `nav-action-button` |
| Scrollable sidebar list | `nav-files-container` |
| List rows | `tree-item` > `tree-item-self` > `tree-item-icon` + `tree-item-inner` + `tree-item-flair-outer` |
| Right-side flair | `tree-item-flair-outer` > `tree-item-flair` |
| Pill / badge | `.tag` |
| Empty state | `pane-empty` |

When custom CSS is unavoidable:
- Always use Obsidian CSS variables (`--text-muted`, `--interactive-accent`, `--font-ui-small`, `--icon-s`, `--size-4-2`, …) — never hardcoded colours/px/font sizes. Use `--icon-xs`/`--icon-s` for icons.
- Custom classes go in `styles.css` with the `llm-` prefix. Never inline `element.style.*` in TypeScript — use `.addClass()` with a named class.
- Writing hover/focus/active states for a list row? Stop — use `tree-item-self`, which already has them.

## Feature Gates (`featureSettings`)

Advanced settings tabs are hidden by default. `LLMPluginSettings.featureSettings` (`FeatureSettings` in `types.ts`) holds a boolean per feature (all default `false`); the "Features" section in General settings is the entry point.

Gated nav items → keys: `obsidian-agent` → `obsidianAgent` (syncs `obsidianAgentSettings.enabled`), `transcription` → `transcription` (syncs `whisperSettings.enabled`), `projects` → `projects`, `assistants` → `assistants`, `memory` → `memory` (syncs `memorySettings.enabled`), `embeddings` → `vaultSearch` (syncs `ragSettings.enabled`).

Toggling calls `LLMSettingsModal.rebuildSidebar()`; disabling the current tab navigates back to General. New gated item: add `featureGate: "keyName"` to its `navSections` entry, add the key to `FeatureSettings`, add a `FeatureDef` in `renderGeneral()`.

## Chats Panel (`ChatsView` + `ChatsSidebar`)

Two implementations of the same chats list:

1. **`src/Plugin/ChatsView/ChatsView.ts`** — standalone `ItemView` (view type `CHATS_VIEW_TYPE = "llm-chats-view"`); `open-chats-panel` command / `plugin.activateChatsPanel()` opens it in the right sidebar.
2. **`src/Plugin/Components/ChatsSidebar.ts`** — `Component` rendering the same list into any container; used by `WidgetView` as a toggleable left panel (toggled by the `messages-square` button in `Header.ts`, widget only). Widget body order: `llm-widget-chats-sidebar` → `llm-widget-main` → `llm-widget-details-sidebar`.

Shared behavior: `plugin.chatHistory.list()` on open, auto-refresh via vault events, title/timestamp/project/agent badges per row, inline search, row click opens the chat in the widget, "new chat" button calls `plugin.activateTab()`. Uses native nav/tree-item/`.tag`/`pane-empty` DOM patterns; CSS prefix `.llm-chats-*`.

## Chat Details Panel (`ChatDetailsView`)

`src/Plugin/ChatDetailsView/ChatDetailsView.ts` — right-sidebar `ItemView` (`CHAT_DETAILS_VIEW_TYPE = "llm-chat-details-view"`) showing live context: model/assistant, recalled memories, context files, guidance files.

- **State is pushed in** by `ChatContainer.pushChatDetailsState()` — the view holds no domain logic. Push points: `syncChips()`, `syncModelDropdown()`, after memory recall, `newChat()` (clears state).
- `plugin.getChatDetailsView()` returns the open instance or `null`; `plugin.activateChatDetailsPanel()` opens it (`open-chat-details-panel` command).
- `ChatDetailsState`: `modelLabel`, `isAssistant`, `assistantId`, `projectName`, `activeProject: { id, name, filePath, folderPath } | null`, `recalledMemories: string[]`, `contextFiles`, `guidanceFiles: { name, path, icon }[]`.
- `activeProject` powers an "Active Project" section: PROJECT.md row (opens in leaf) + folder row (revealed via `internalPlugins.file-explorer.revealInFolder`).
- Recalled memories are parsed from the `# Recalled Memories` block returned by `MemoryService.recall()` (lines starting `"- "`).
- `detailsBodyEl` (not `contentEl`) is the scrollable render target. CSS prefix `.llm-chat-details-*`.

## Whisper Transcription

Two speech-to-text features behind `whisperSettings.enabled`:

- **Voice input** — mic button in the chat toolbar (idle/recording/transcribing); `MediaRecorder` audio → `WhisperService`; transcript inserted into input (or auto-sent when `autoSend`).
- **File transcription → note** — "Transcribe audio file" command; Electron `remote.dialog` picker → Node `fs` read → `WhisperService` → markdown note in `outputFolder`.

Backends (both in `src/Whisper/WhisperService.ts`): `"openai"` (`/audio/transcriptions`, whisper-1, uses `openAIAPIKey`) and `"sidecar"` (local Python `whisper-server.py`, faster-whisper; uses browser `fetch`+`FormData` — not `requestUrl`, sidecar needs multipart).

Key files: `WhisperService.ts`, `SidecarManager.ts` (detects python3/pip3, installs deps, starts/stops the sidecar; always instantiated as `plugin.sidecarManager`, `isServerOwned` true only when we spawned it), `TranscribeCommand.ts`, `TranscribeUtils.ts`, root-level `whisper-server.py` (FastAPI; `POST /transcribe`, `GET /health`).

Integration: `LLMPlugin.whisperService` is null when disabled — call `plugin.initWhisperService()` after toggling. `ChatContainer._triggerSend` closure (wired in `generateChatContainer`) lets voice auto-send fire the full send action. `ChatContainer.micButton` only exists when Whisper was enabled at container build time (CSS states `llm-mic-recording`, `llm-mic-transcribing`). `whisperSettings` is deep-merged in `loadSettings()`.

**Electron note:** `require("electron")` is cast as `any` — `@types/electron` is not installed; do not add a typed import.

## RAG / Vault Search

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

### Tool call recording in chat files

`ChatContainer` tracks `pendingToolCalls: ToolCallRecord[]` (current agent turn) and `allToolCallsByTurn: Map<number, ToolCallRecord[]>` (keyed by 0-based assistant-message index, captured as `turnIndex` at `runAgentMode` start; committed after the turn). Both reset in `newChat()`. `ChatHistory.save()` takes an optional `toolCallsByTurn`; `messagesToMarkdown` writes a `> [!tool-use]-` callout after each `## Assistant` heading, and `markdownToMessages` strips these so they never pollute re-submitted context.

## Skills System

Vault-native skills: each skill is a folder under `plugin.skillsFolder` (getter: `<rootVaultFolder>/Skills`) containing `SKILL.md`.

**Built-in skills** (`src/Skills/BuiltinSkills.ts`, `BUILTIN_SKILLS`): `obsidian-markdown` (from kepano/obsidian-skills, MIT), `obsidian-bases`, `json-canvas`. Seeded non-destructively on first run and on `reinitSkillRegistry`. New built-in = new `BuiltinSkillDef` entry; `id` becomes folder name and skill id.

**SKILL.md frontmatter**: `name`, `description`, `allowed-tools` (restricts ObsidianToolRegistry tools; empty = all), `disable-model-invocation` (true → instruction body rendered directly as the reply, no API call), `argument-hint` (grayed-out hint in the slash picker). Body = instructions injected as system context. `{{args}}` in the body is replaced with text typed after the slash prefix (slash-invoked skills only).

**Key files**: `src/Skills/SkillRegistry.ts` (discovery/parsing, hot-reload on vault events), `src/Plugin/Components/SkillsContainer.ts` (per-skill toggles), `src/Settings/LLMSettingsModal.ts` (Skills nav item).

**Invocation** (three ways):
1. Slash command `/skill-id` — floating picker shows while input matches `^\/[a-zA-Z0-9_-]*$`; prefix parsed in `handleGenerateClick` and stripped before the API call.
2. `+` button menu → "Add a skill" submenu → inserts `/skill-id ` into the textarea.
3. Global enable in Settings → Skills — instructions injected into every message; `allowed-tools` unioned.

Slash picker items show icon | name + hint | description | edit pencil (pencil uses `stopPropagation()` on mousedown; opens SKILL.md via `getLeaf(false).openFile`).

**Skill display**: chat UI shows a `llm-skill-panel` banner above the assistant message; saved files get a `> [!tip]- Skill: <id>` callout after `## Assistant` (stripped on load). Data flow: `ChatContainer.allSkillsByTurn: Map<number, string>` (cleared in `newChat()`); `setSkillsByTurn(map)` restores on file load (called in `Widget.ts`, `HistoryContainer.ts`, `StatusBarButton.ts`); `ChatHistory.save()` takes optional `skillsByTurn` (7th arg); `load()` returns it on `LoadedChat`.

**Icon convention**: all skills UI uses the `scroll-text` lucide icon. The Skills tab was removed from the chat header — selection is via slash command or `+` button.

**AgentLoop**: optional `allowedTools: string[]` 5th constructor arg — when non-empty, only those tools are exposed. `runAgentMode` passes `skillAllowedTools`.

**Settings**: `skillsSettings: SkillsSettings` deep-merged with `{ enabledSkills: {} }`. The folder is NOT stored in settings — derived from `rootVaultFolder` (default `"AI"`; Skills/Projects/Memories all live under it). After changing `rootVaultFolder`, `reinitSkillRegistry()` and `reinitProjectManager()` are called.

## Memory System

Cross-session memories as plain markdown files in the vault.

**Hierarchy**: `<rootVaultFolder>/Memories/<uuid>.md` (global, always recalled); `Assistants/<name>/memories/` (when assistant active); `Projects/<name>/memories/` (when project active).

**File format**: frontmatter `created` (ISO), `source` (`"global"` | assistant | project name), `type` (`"fact" | "preference" | "context"`); body = one-sentence memory.

**`src/Memory/MemoryService.ts`**: `extractAndSave(messages, scope, scopeName, callModel)` (model call with structured JSON prompt; skips duplicates at cosine ≥ 0.92), `recall(query, ctx, topK, indexer)` (VaultIndexer hybrid search restricted to active scope folders; deduped by filePath; block prepended to `pendingContextString`), `isMemoryFile(path)`, `loadMemoriesFromFolder(folder)` (adapter-based, bypasses TFile cache).

Extraction is provider-agnostic — `ChatContainer.buildMemoryCallModel()` builds the wrapper for the active provider. A `llm-memory-panel` indicator appears when memories were injected.

**Settings** (`memorySettings`, deep-merged): `enabled` (requires RAG for recall), `extractionTrigger: "end-of-chat" | "manual"`, `recallTopK`. `recallAlways` is **deprecated/unused** — `useMemory` is always `true` when enabled (no toggle chip; kept in the type for backward compat). Per-conversation opt-out exists via the `+` menu.

**/remember command**: `/remember [content]` saves verbatim as a `fact` memory, no model call; intercepted in `handleGenerateClick` before skill resolution. Also in the `+` menu ("Save a memory…", memory-enabled only). Duplicate check still applies.

**ChatContainer hooks**: `extractMemories()` (toolbar button or auto at `newChat()` with `"end-of-chat"` trigger), `appendMemoryIndicator(container)`, `buildMemoryCallModel()`.

**RAG dependency**: recall needs `plugin.vaultIndexer` non-null. Memory files are indexed by the existing vault `modify` watcher. `plugin.initMemoryService()` rebuilds with RAG's `EmbeddingService` config.

## Projects System

Named workspaces scoping chat context: system instructions, pinned notes, memory recall.

**Hierarchy**: `<rootVaultFolder>/Projects/<project-id>/PROJECT.md` + `memories/`.

**PROJECT.md frontmatter**: `name`, `description`, `pinned-notes` (paths), `default-assistant` (optional), `created`. Body = system instructions injected as system-prompt prefix.

**`src/Projects/ProjectManager.ts`** — discovery/parsing/hot-reload, same pattern as `SkillRegistry`. Types in `src/Types/types.ts`.

Integration:
- `LLMPlugin.projectManager` singleton; `projectSettings.activeProjectId` persisted (deep-merged default `{ activeProjectId: null }`); `plugin.projectsFolder` getter. `reinitProjectManager()` on `rootVaultFolder` change. Managed via Settings → Features → Projects.
- Switching projects does **not** auto-start a new chat; chip strip refreshed via `syncChips()`.
- On send with active project: pinned notes injected as `# Pinned Project Notes`; instructions as `# Project Instructions: <name>`; recall passes `activeProject: project.name`.
- Saved chats get `project: "<name>"` frontmatter, and **chat files co-locate with their project** in `Projects/<projectId>/chats/` (moved there/back via `ChatHistory.moveToFolder()` and `updateProjectField()`).
- **`ChatContainer.setActiveProject(projectId | null)` is the single authority** for changing the active project at runtime (moves file, patches frontmatter, updates settings, syncs chips). Never mutate `activeProjectId` directly in UI handlers.
- **`ChatContainer.restoreProjectFromChat(filePath, metaProjectName?)`** runs after every chat file load (HistoryContainer, Widget, StatusBarButton): detects membership from path first (`Projects/<id>/chats/`), then `meta.project` name, else clears `activeProjectId`.
- UI: pinned notes = non-removable dashed chips; active project = `.llm-project-chip` (icon at rest, expands on hover with name + ×). Project selection: "+ button" menu (new chat) or more-options menu (started chat). There is **no project switcher pill** in the header (`buildProjectSwitcher`/`updateProjectSwitcher` removed from `Header.ts`).

## Assistants System

Vault-native AI personas as `ASSISTANT.md` files. **Distinct from the OpenAI Assistants API integration** (`AssistantHandler.ts`/`AssistantsContainer.ts`) — do not modify those files.

**Hierarchy**: `<rootVaultFolder>/Assistants/<assistant-id>/ASSISTANT.md` + `memories/`.

**ASSISTANT.md frontmatter**: `name`, `description`, `provider`/`model` (informational only), `preferred-model` (auto-selected when assistant chosen), `enabled-skills` (skill ids), `allowed-tools` (tool names), `created`. Body = system prompt injected when active.

**`src/Assistants/AssistantManager.ts`** — discovery/parsing/hot-reload (adapter-based, same pattern as SkillRegistry/ProjectManager) plus `createAssistant()`/`deleteAssistant()`.

Integration:
- `LLMPlugin.assistantManager` singleton; `assistantSettings.activeAssistantId` persisted (default `{ activeAssistantId: null }`); `plugin.assistantsFolder` getter; `reinitAssistantManager()` on `rootVaultFolder` change. Managed via Settings → Core Settings → Assistants.
- On send with active assistant: `enabled-skills` union with globally-enabled skills; `allowed-tools` **intersect** with skill restrictions (most restrictive wins); system prompt injected as `# Assistant: <name>` **after** project instructions (project outer, assistant inner); recall passes `activeAssistant: assistant.id`.
- No explicit assistant + project `default-assistant` → that assistant auto-activates.
- Memory extraction scope: project active → project memories; only assistant → assistant memories; neither → global.
- Selection via the combined model+assistant dropdown in the chat toolbar (two `<optgroup>`s: Models / Assistants). Choosing an assistant sets `activeAssistantId`, may switch to `preferredModel`, starts a new chat; choosing a plain model clears the assistant. `syncAssistantDropdownOptions()` rebuilds the optgroup on hot-reload.
- `.llm-assistant-panel` — per-response indicator (analogous to skill/memory panels).

**Context injection order** (top → bottom): recalled memories → project instructions → assistant system prompt → skill instructions → vault/file context.

## Obsidian Agent

The single always-available primary agent: knows the vault, can invoke any enabled Skill, routes to Assistants.

**Entry points** (when `obsidianAgentSettings.enabled`): FAB (`generateFAB()` sets `chatContainer.isObsidianAgent = true`), status bar popover, `open-obsidian-agent` command (`ChatModal2(plugin, true)`), and `ChatModal2` reads the setting when opened without the flag.

**Agent mode in ChatContainer** (`isObsidianAgent: boolean`):
1. After memory recall, `ObsidianAgent.buildSystemPrompt()` is appended to `pendingContextString` (memories stay first).
2. `runAgentMode` passes an `extraSetup` callback to `AgentLoop` that calls `ObsidianAgent.registerTools(registry)` — registers the dynamic `invoke_assistant` tool (only when agent-available assistants exist). Execution returns the assistant's system prompt + task as a string — the main loop continues from that persona (no sub-AgentLoop).
3. `onToolResult` captures the routed assistant name; `appendAgentRoutingIndicator()` adds a `.llm-agent-routing-panel` banner after generation.
4. New files tagged `agent: true` in frontmatter (`ChatFileMeta.agent?: boolean`).

**`buildSystemPrompt()` is async** — reads `obsidianAgentSettings.agentGuidanceFile` from the vault if configured. Composes: identity paragraph, available Skills (filtered by `availableSkills`), available Assistants + `invoke_assistant` instructions (filtered by `availableAssistants`), projects list, chat-history folder paths (when `chatHistoryEnabled`), guidance file content.

**Two distinct guidance files**:

| File | Setting | Scope |
|------|---------|-------|
| `AI/OBSIDIAN-AGENT.md` (default empty) | `obsidianAgentSettings.agentGuidanceFile` | Obsidian Agent turns only (inside `buildSystemPrompt()`) |
| `AI/AGENTS.md` (default path) | `LLMPluginSettings.agentsFilePath` | Every conversation — prepended to `pendingContextString` before memory recall |

Both use the shared `renderGuidanceFilePicker()` helper in `LLMSettingsModal` (path input + smart Open/Create button). Call `plugin.refreshAllChips()` after `agentsFilePath` changes. **Guidance files are not chips** — they render in the Chat Details panel "Guidance" section (`ChatDetailsState.guidanceFiles`; `"book-open"` icon for AGENTS.md, `"scroll-text"` for OBSIDIAN-AGENT.md; rendered by `renderGuidanceSection()` in `ChatDetailsRenderer.ts`).

**Settings** (`obsidianAgentSettings`, deep-merged): `enabled` (toggling regenerates the FAB), `enableWebSearch` (placeholder), `availableSkills` / `availableAssistants` (`Record<string, boolean>`; missing keys = available), `agentGuidanceFile`.

**Dynamic tools**: `ObsidianToolRegistry.registerDynamicTool(def, executor)` adds tools at runtime. `AgentLoop` optional constructor args: `extraSetup?: (registry) => void` (8th), `chatHistory?: ChatHistory` (9th, forwarded to the registry).

**`get_chat_history` tool** (static, in `ALL_TOOL_DEFINITIONS`): action `list` (filenames + mtimes; `limit`, `filter_project`, `filter_agent`) and action `load` (full metadata + parsed turns). `runAgentMode` passes `this.plugin.chatHistory` when `chatHistoryEnabled`. `buildSystemPrompt()` injects a `## Chat History` section describing folder paths.

**Token usage**: `.llm-token-usage` indicator below each response when the provider reports usage ("↑ N ↓ N tokens"); rendered by `appendTokenUsage()`, cleared in `newChat()`.

## Web Search (SearXNG)

Self-hosted SearXNG instance behind `searxngSettings.enabled`; exposes a `web_search` tool to tool-capable models.

**`src/WebSearch/SearxngService.ts`**: `search(query, numResults?)` (uses `throw: false`; converts 429/403/5xx to descriptive `SearxngHttpError` with `.status`; browser-like UA/Accept headers to dodge bot detection), `checkHealth()` (probes `/healthz`, falls back to a minimal search; returns `true` on 429 — instance up, just rate-limited), static `formatResults()` (renders `**N. [Title](URL)**` markdown so the model reproduces clickable citations).

**Settings** (`searxngSettings`, deep-merged): `enabled` (toggling calls `plugin.initSearxngService()`), `host` (default `http://localhost:8080`), `maxResults` (1–10, default 5). `LLMPlugin.searxngService` is null when disabled/blank host.

**Tool integration**: `web_search` in `ALL_TOOL_DEFINITIONS` with `requiresWebSearch: true` (Settings → Tools shows a warning when SearXNG is off). The executor try/catches and returns error text to the model — never throws. `AgentLoop` takes `searxngService` as its 11th constructor arg, forwards it to `ObsidianToolRegistry` (4th arg); `runAgentMode` passes `this.plugin.searxngService`.

**Web sources panel**: `ChatContainer` regex-parses `**N. [Title](URL)**` links from the tool result into `pendingWebSources`; `appendWebSourcesPanel()` renders a collapsible `<details class="llm-web-sources">` panel (same pattern as RAG sources). Cleared in `newChat()` and on error.

**Settings UI**: "Web Search" group under Settings → Obsidian Agent (visible only when agent enabled): enable toggle, host + Test connection button, max-results slider.

**Common setup issue**: the official SearXNG Docker image needs `server.limiter: false` (default true → 429 for non-browser clients) and `json` added under `search.formats` (default omits it → 403) in the host-mounted `settings.yml`, then `docker restart searxng`.

## Key Files

- `src/Plugin/ObsidianAgent/ObsidianAgent.ts` — system prompt builder, `registerTools()`, `invoke_assistant`
- `src/WebSearch/SearxngService.ts` — SearXNG wrapper, `SearxngHttpError`, `formatResults()`
- `src/Assistants/AssistantManager.ts` / `src/Projects/ProjectManager.ts` — discovery, parsing, hot-reload, create/delete
- `src/Memory/MemoryService.ts` — memory extraction, dedup, recall, persistence
- `src/Types/types.ts` — TypeScript interfaces (ChatParams, ImageParams, RAGSettings, MemorySettings, ProjectSettings, AssistantSettings, ObsidianAgentSettings, …)
- `src/utils/constants.ts` — provider/model/endpoint constants
- `src/utils/models.ts` — model configuration definitions
- `src/utils/utils.ts` — API validation and helpers

## Constants Convention

All endpoint type strings live in `src/utils/constants.ts` and must be imported as constants — never compared against raw string literals. Endpoint constants: `chat`, `messages`, `images`, `claudeCodeEndpoint`. Provider constants: `openAI`, `claude`, `claudeCode`, `gemini`, `mistral`, `ollama`, `lmStudio`, `GPT4All`.
