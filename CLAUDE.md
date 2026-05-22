# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Known Pitfalls

### `view.addAction()` survives hot-reloads — always scrub before adding

`view.addAction()` appends a button to a **persistent** DOM element inside the MarkdownView header. That DOM survives plugin hot-reloads. Any Map or variable used to track "have we already added this button?" is scoped to the plugin instance and starts empty on every load.

**Consequence:** if you call `addAction()` on hot-reload without checking the DOM first, a second button appears alongside the orphaned one from the previous load.

**Rule:** Before calling `view.addAction()` for any button with a custom class, query the view's container for that class and remove any existing element first:

```ts
const stale = (view.containerEl as HTMLElement | undefined)
    ?.querySelector?.(".your-custom-class") as HTMLElement | null;
stale?.remove();
const btn = view.addAction("icon", "Tooltip", handler);
btn.addClass("your-custom-class");
```

This also means the custom class is load-bearing — never skip `btn.addClass(...)` after `addAction()`.

---

## Build Commands

```bash
npm run dev      # Start development with watch mode (esbuild watches for changes)
npm run build    # Production build (TypeScript type-check + esbuild bundle)
npm run version  # Bump version in manifest.json and versions.json
```

Output is bundled to `main.js` in the root directory.

### CSS / Styling Convention (repeated below — see full entry near bottom)

## Obsidian Core Styling — Use Native Before Custom

**Always prefer Obsidian's built-in components and CSS classes over custom implementations.** Custom CSS is harder to maintain and will look out of place when the user changes themes. Native components get theming, accessibility, and hover/focus states for free.

### Prefer native Obsidian components

| Need | Use instead of rolling your own |
|------|----------------------------------|
| Search box | `SearchComponent` → renders `search-input-container` with icon + clear button |
| Icon-only button | `ExtraButtonComponent` → renders `clickable-icon` |
| Standard button | `ButtonComponent` → renders correctly styled `<button>` |

### Prefer native CSS classes

| UI element | Native class(es) |
|-----------|-----------------|
| Sidebar toolbar | `nav-header`, `nav-buttons-container`, `nav-action-button` |
| Scrollable sidebar list | `nav-files-container` |
| List rows | `tree-item` > `tree-item-self` > `tree-item-icon` + `tree-item-inner` + `tree-item-flair-outer` |
| Row title text | `tree-item-inner-text` |
| Right-side flair (counts, dates) | `tree-item-flair-outer` > `tree-item-flair` |
| Pill / badge | `.tag` |
| Empty state | `pane-empty` |
| Clickable icon button | `clickable-icon` |

### When writing custom CSS

- Always use Obsidian CSS variables (`--text-muted`, `--interactive-accent`, `--font-ui-small`, `--icon-s`, etc.) — never hardcoded colours, px sizes, or font sizes.
- Custom classes belong in `styles.css` with the `llm-` prefix. Never use inline `element.style.*` in TypeScript — use `.addClass()` with a named CSS class.
- If you find yourself writing hover, focus, or active states for a list row, stop — you should be using `tree-item-self` which already has them.

## Feature Gates (`featureSettings`)

All advanced feature tabs are hidden from the settings sidebar by default. `LLMPluginSettings.featureSettings` (type `FeatureSettings` in `types.ts`) holds a boolean per feature, all defaulting to `false`. The "Features" section in the General settings tab is the user-facing entry point.

Gated nav items and their corresponding `featureSettings` key:
- `obsidian-agent` → `obsidianAgent` (also syncs `obsidianAgentSettings.enabled`)
- `transcription` → `transcription` (also syncs `whisperSettings.enabled`)
- `projects` → `projects`
- `assistants` → `assistants`
- `memory` → `memory` (also syncs `memorySettings.enabled`)
- `embeddings` → `vaultSearch` (also syncs `ragSettings.enabled`)

When a feature is toggled on/off, `LLMSettingsModal.rebuildSidebar()` is called so the sidebar updates immediately. If the user disables a feature while on that tab, it auto-navigates back to General.

To add a new gated nav item: add `featureGate: "keyName"` to its entry in `navSections`, add the key to `FeatureSettings`, and add a `FeatureDef` entry in `renderGeneral()`.

## Obsidian Review Compliance

### `MarkdownRenderer.render` — use `this`, not `this.plugin`

`ChatContainer extends Component`. Always pass `this` (the `ChatContainer` instance) as the 5th `Component` argument to `MarkdownRenderer.render()`. Never pass `this.plugin`. The plugin instance lives for the entire Obsidian session, so passing it prevents cleanup of rendered markdown children and triggers Obsidian's automated review warning: *"Avoid using the main plugin instance as a component. Its lifecycle is too long, which can cause memory leaks."*

`ChatContainer` calls `this.load()` in its constructor and `this.unload()` in `destroy()`, so rendered content is properly cleaned up when the view closes.

## Architecture Overview

This is an Obsidian plugin that provides LLM chat interfaces with support for OpenAI, Anthropic Claude, Google Gemini, Mistral AI, local Ollama, local LM Studio, and local GPT4All.

### Entry Point and Plugin Lifecycle

`src/main.ts` contains the `LLMPlugin` class which:
1. Initializes platform abstractions (Desktop vs Mobile)
2. Loads settings from Obsidian's data store
3. Registers commands and views
4. Initializes MessageStore, History, Assistants, and FAB components

### View Architecture (Four UI Implementations)

The plugin provides four ways to access the chat interface, all using the same underlying components:

- **Modal** (`src/Plugin/Modal/ChatModal2.ts`) - Popup dialog
- **Widget** (`src/Plugin/Widget/Widget.ts`) - Sidebar tab view
- **FAB** (`src/Plugin/FAB/FAB.ts`) - Floating Action Button with expandable chat
- **StatusBarButton** (`src/Plugin/StatusBar/StatusBarButton.ts`) - "Ask AI" button in the status bar that opens a popover chat. Uses `viewType: "floating-action-button"` and shares `fabSettings` with the FAB. Its popover is built once on `generate()` (not per-open), so call `chatContainer.syncModelDropdown()` whenever the popover is shown to keep the model dropdown in sync with settings.

Each view composes these shared components from `src/Plugin/Components/`:
- `Header.ts` - Tab navigation (Chat/History/Settings/Assistants)
- `ChatContainer.ts` - Message display, input handling, API calls
- `HistoryContainer.ts` - Chat history list
- `SettingsContainer.ts` - Model/parameter configuration
- `AssistantsContainer.ts` - OpenAI assistants selection

### Chats Panel (`ChatsView` + `ChatsSidebar`)

Two implementations of the chats list exist — both show the same data and use the same Obsidian DOM patterns:

1. **`src/Plugin/ChatsView/ChatsView.ts`** — standalone `ItemView` sidebar leaf (view type `CHATS_VIEW_TYPE = "llm-chats-view"`). Registered in `main.ts`; opened via the `open-chats-panel` command ("Open Chats panel"). `plugin.activateChatsPanel()` opens it in the right sidebar.

2. **`src/Plugin/Components/ChatsSidebar.ts`** — `Component` subclass that renders the identical chats list into any container element. Used by `WidgetView` to embed a **toggleable left-side chats panel** directly inside the widget body. Toggled by the `messages-square` button in `Header.ts` (widget view only). `render(el)` populates the container; `destroy()` calls `this.unload()` to clean up vault event listeners. The widget body order is: `llm-widget-chats-sidebar` (left) → `llm-widget-main` → `llm-widget-details-sidebar` (right).

Key design points (shared):
- Calls `plugin.chatHistory.list()` on open and refreshes automatically via vault `create/modify/delete/rename` events.
- Displays title (frontmatter), relative timestamp, project badge, and agent badge per row.
- Inline search box filters by title and project name.
- Clicking a row calls `plugin.openChatFileInWidget(filePath)` — opens (or focuses) the chat widget and loads that conversation.
- A "new chat" icon button calls `plugin.activateTab()`.
- CSS classes use the `.llm-chats-*` prefix; all values use Obsidian CSS variables.

Native Obsidian DOM/component patterns used (keeps the panel visually consistent with Obsidian's own sidebar panels):
- `SearchComponent` → renders `search-input-container` with icon + clear button
- `ExtraButtonComponent` → renders `clickable-icon` / `nav-action-button` for the toolbar
- `nav-header` / `nav-buttons-container` → toolbar chrome
- `nav-files-container` → scrollable list area
- `tree-item` / `tree-item-self` / `tree-item-inner` / `tree-item-flair` → row structure (mirrors file-explorer)
- `.tag` → project and agent pill badges
- `pane-empty` → empty-state message

### Chat Details Panel (`ChatDetailsView`)

`src/Plugin/ChatDetailsView/ChatDetailsView.ts` — a right-sidebar `ItemView` (view type `CHAT_DETAILS_VIEW_TYPE = "llm-chat-details-view"`) that shows live context for the active chat: the current model/assistant, recalled memories, and attached context files.

Key design points:
- **State is pushed in** by `ChatContainer.pushChatDetailsState()` — the view holds no domain logic; it just renders whatever it receives.
- Push points: `syncChips()` (file/project changes), `syncModelDropdown()` (model/assistant switch), after memory recall in `handleGenerateClick`, and `newChat()` (clears state + resets `lastRecalledMemories`).
- `plugin.getChatDetailsView()` returns the open view instance (or `null` if closed) — used by `pushChatDetailsState()`.
- `plugin.activateChatDetailsPanel()` opens the panel in the right sidebar; registered as the `open-chat-details-panel` command ("Open Chat Details panel").
- `ChatDetailsState` interface has: `modelLabel`, `isAssistant`, `assistantId`, `projectName`, `activeProject: { id, name, filePath, folderPath } | null`, `recalledMemories: string[]`, `contextFiles: { name, path }[]`, `guidanceFiles: { name, path, icon }[]`.
- `activeProject` powers a dedicated "Active Project" section in the panel with two clickable rows: PROJECT.md (opens in a leaf) and the project folder (revealed in the file explorer via `internalPlugins.file-explorer.revealInFolder`).
- Recalled memories are parsed from the `# Recalled Memories` block returned by `MemoryService.recall()` (lines starting with `"- "`).
- CSS classes use the `.llm-chat-details-*` prefix.
- `detailsBodyEl` (not `contentEl`) is the scrollable render target — `ItemView` already owns `contentEl`.

### State Management

- **MessageStore** (`src/Plugin/Components/MessageStore.ts`) - Pub/sub pattern for in-memory message state; synchronizes all views
- **Settings** (in `main.ts`) - Persisted configuration via Obsidian's `loadData`/`saveData`
- **HistoryHandler** (`src/History/HistoryHandler.ts`) - Manages legacy in-settings chat history (unbounded; superseded by file-based `ChatHistory` when `chatHistoryEnabled: true`, which is now the default)
- **AssistantHandler** (`src/Assistants/AssistantHandler.ts`) - OpenAI assistants state

#### Scan-button context locking (`activeFileForChip`)

`ChatContainer.activeFileForChip` is `{ name: string; path: string } | null`. When the user activates the scan button, the file's **path** is stored at that moment and held for the life of the conversation. Two invariants must be preserved:

1. **Send time reads the stored path, not `getActiveFile()`** — the `useActiveFileContext` block in `handleGenerateClick` resolves the file via `activeFileForChip.path` (falling back to `getActiveFile()` only when no chip is set). Do not revert this to a bare `getActiveFile()` call, or switching tabs mid-task will silently swap the injected context.
2. **`refreshActiveFileChip()` is a no-op mid-conversation** — it guards on `this.getMessages().length > 0` and returns early, so opening the popover on a different note doesn't re-point the chip. The chip only auto-updates when the chat is empty (before the first send) or after `newChat()` resets state.

### Message Flow

1. User input in `ChatContainer` triggers `handleGenerateClick()`
2. Message added to MessageStore, which notifies all subscribers
3. API call made based on selected provider (OpenAI/Claude/Gemini/Mistral/Ollama/LM Studio/GPT4All)
4. Streaming response updates UI in real-time
5. Conversation saved to History

#### Render generation guard (`renderGeneration`)

`updateMessages` (the MessageStore subscriber) re-renders the full message list by calling `resetChat()` then `generateIMLikeMessages()`. Because `generateIMLikeMessages` is async (it `await`s `renderMarkdown` inside each `createMessage` call), a stale render can continue appending DOM nodes into a container that has already been cleared by a newer render, producing duplicated or out-of-order messages.

To prevent this, `ChatContainer` maintains a `renderGeneration` counter. `updateMessages` increments it and passes the new value to `generateIMLikeMessages`. The render function checks `gen !== this.renderGeneration` before each message and before the final scroll — if it no longer holds the latest generation it returns immediately.

**Do not remove this guard or make `generateIMLikeMessages` synchronous without understanding this invariant.** The race is subtle: it only manifests when the user sends a second message quickly (or when the store is updated programmatically in quick succession), so it is easy to miss in manual testing.

#### `MessageStore.setMessages` copies the input array

`setMessages` stores a shallow copy (`[...messages]`) rather than the direct reference. This prevents subsequent `addMessage` pushes from mutating the caller's array — notably `promptHistory[n].messages` in the legacy array-based history path.

### Platform Abstraction

`src/services/` provides abstractions for cross-platform compatibility:
- `FileSystem.ts` - Desktop/Mobile file operations
- `OperatingSystem.ts` - Desktop/Mobile OS detection

### API Integration

Provider SDKs used:
- `openai` - Chat, images (gpt-image-1), assistants
- `@anthropic-ai/sdk` - Claude models + Claude Code (agent SDK)
- `@google/generative-ai` - Gemini models
- Mistral — uses `openai` SDK with custom baseURL (`https://api.mistral.ai/v1`)
- Ollama — uses `openai` SDK with custom baseURL (default `http://localhost:11434/v1`); models discovered dynamically via `/api/tags`
- LM Studio — uses `openai` SDK with custom baseURL (default `http://localhost:1234/v1`); models discovered dynamically via `/v1/models`; no real API key required (uses `"lm-studio"` as placeholder)
- GPT4All connects to local server on port 4891

### Whisper Transcription

The plugin supports two speech-to-text features gated behind `plugin.settings.whisperSettings.enabled`:

- **Feature 1 — Voice input**: A mic button in the chat input toolbar. Three states: idle / recording / transcribing. Uses the browser `MediaRecorder` API; audio is sent to `WhisperService` on stop. Transcript is inserted into the input field (or auto-sent if `autoSend` is true).
- **Feature 2 — File transcription → note**: Command palette entry "Transcribe audio file". Opens the system file picker via Electron's `remote.dialog`, reads the selected file with Node.js `fs`, posts it to `WhisperService`, and writes a markdown note to the configured `outputFolder`.

**Two backends — both implemented in `src/Whisper/WhisperService.ts`:**
- `"openai"`: OpenAI `/audio/transcriptions` endpoint (whisper-1, `verbose_json`). Uses the existing `openAIAPIKey`. Audio leaves the machine.
- `"sidecar"`: Local Python `whisper-server.py` (faster-whisper). Uses browser `fetch` with `FormData` (not `requestUrl` — sidecar needs multipart). Fully private.

**Key files:**
- `src/Whisper/WhisperService.ts` — service class; `transcribeBlob()`, `transcribeFilePath()`, `checkHealth()`, `buildNoteContent()`, `formatForNote()`
- `src/Whisper/SidecarManager.ts` — detects `python3`/`pip3`, installs deps via `pip3` with streaming output, starts/stops `whisper-server.py` as a child process. Always instantiated as `plugin.sidecarManager` (not gated on enabled flag).
- `src/Whisper/TranscribeCommand.ts` — Feature 2 command handler (file picker → transcribe → vault write)
- `src/Whisper/TranscribeUtils.ts` — `createFolderOrPrompt()` modal helper
- `whisper-server.py` — FastAPI + faster-whisper sidecar (ships in plugin root); `POST /transcribe`, `GET /health`

**Integration points:**
- `LLMPlugin.whisperService: WhisperService | null` — null when disabled. Call `plugin.initWhisperService()` after toggling `whisperSettings.enabled`.
- `LLMPlugin.sidecarManager: SidecarManager` — always available; used by the settings wizard to detect Python, install deps, and start/stop the server. `isServerOwned` is true only when we spawned the process ourselves.
- `ChatContainer._triggerSend: (() => void) | null` — closure wired by `generateChatContainer` so voice auto-send can fire the full send action (including clearing the field) without holding references to `header`/`sendButton`.
- `ChatContainer.micButton` — only created when Whisper is enabled at container build time. Three CSS states: `llm-mic-recording` (pulsing red), `llm-mic-transcribing` (muted, disabled), default (inherits `.llm-scan-button`).
- Settings: `whisperSettings: WhisperSettings` — deep-merged in `loadSettings()`. Includes `backend`, `sidecarHost`, `whisperModel`, `language`, `includeTimestamps`, `outputFolder`, `autoOpenNote`, `autoSend`, `lastPickerDirectory`.

**Electron note:** `require("electron")` is cast as `any` — `@types/electron` is not installed. Do not add a typed import.

**Deferred:** Feature 3 (AI-assisted transcription) and Transformers.js local backend — see memory for design notes.

### RAG / Vault Search

The plugin supports semantic search over the user's vault via three classes in `src/RAG/`:

- **`VectorStore.ts`** — Persists embeddings as a flat JSON file (path passed via constructor). Provides cosine similarity search and incremental updates (skips files whose `mtime` hasn't changed). `save()` ensures the parent directory exists before writing — always use `vault.adapter.mkdir()` guard before any `adapter.write()` to a plugin-relative path, as the directory may not exist on fresh installs. **Important**: always call `store.ensureLoaded()` (or `store.load()`) before calling `store.upsert()` or `store.save()` outside of `indexVault()` — otherwise a partial in-memory state will overwrite the full on-disk index. `VaultIndexer.indexFile()` calls `ensureLoaded()` for this reason.
- **`EmbeddingService.ts`** — Provider-agnostic embedding generation. Supports OpenAI (`text-embedding-3-small`), Gemini (`text-embedding-004`), Ollama, and LM Studio (all via the OpenAI-compatible `/v1/embeddings` endpoint). LM Studio calls must pass `encoding_format: "float"` explicitly. Reuses API keys/hosts already stored in plugin settings.
- **`VaultIndexer.ts`** — Orchestrates indexing (chunking by paragraph, ~1500 chars per chunk with file path + heading prefix) and exposes `semanticSearch(query, topK)` which returns a formatted markdown context block. Calls `EmbeddingService.checkOllamaModel()` before indexing to surface a clear pull-command error if the Ollama model isn't available.

**How it integrates:**
- `LLMPlugin.vaultIndexer` is the singleton instance; call `plugin.initVaultIndexer()` after any RAG setting change.
- `LLMPlugin` registers `vault.on('modify')`, `vault.on('delete')`, and `vault.on('rename')` events to keep the index incrementally up-to-date. Modify events are debounced (2 s) to avoid hammering the embedding API during rapid autosaves.
- `ObsidianToolRegistry` receives the `VaultIndexer` and exposes a `search_vault_semantic` tool (`risk: "safe"`). Tool-capable models (Claude, GPT-4, Gemini, Ollama, Mistral) call this autonomously via `AgentLoop`.
- **Targeted write tools** (prefer these over `obsidian_modify_note` for partial edits):
  - `obsidian_insert_after_heading` — inserts content on a new line immediately after a named heading (case-insensitive, strips leading `#`). Returns an error if the heading isn't found.
  - `obsidian_patch_note` — finds an exact string and replaces it in one operation. Returns an error if the string is absent or appears more than once (the model should widen the `old_string` to make it unique).
- `AgentLoop` fires `AgentCallbacks.onToolResult(toolName, input, result)` after each successful tool execution — `ChatContainer` uses this to (a) capture `search_vault_semantic` results and populate the cited sources panel, and (b) record the call in `pendingToolCalls` for inclusion in the saved chat file.
- `ChatContainer` has a `useVaultSearch` toggle (toolbar button, always visible when RAG is enabled) that pre-fills `pendingContextString` with top-k results — a reliable manual fallback especially for Ollama/LM Studio/Mistral models whose tool-calling support varies per model. After generation, a collapsible "Sources" panel (`<details class="llm-rag-sources">`) is appended listing the contributing files as clickable links.
- Search uses **hybrid scoring**: 70% cosine similarity + 30% BM25 keyword score. BM25 IDF is computed at search time across the in-memory corpus. The `VectorStore.hybridSearch()` method handles both; `VectorStore.search()` delegates to it with full vector weight for pure semantic use.
- RAG settings live under `plugin.settings.ragSettings` (`RAGSettings` type in `types.ts`) and are configured in `LLMSettingsModal` under the "Vault Search" tab.

#### Tool call recording in chat files

`ChatContainer` tracks tool calls via two instance vars: `pendingToolCalls: ToolCallRecord[]` (accumulates during the current agent turn) and `allToolCallsByTurn: Map<number, ToolCallRecord[]>` (keyed by 0-based assistant-message index). At the start of `runAgentMode` the current assistant-message count is captured as `turnIndex`; `onToolResult` pushes to `pendingToolCalls`; after the turn completes the pending calls are committed to `allToolCallsByTurn.set(turnIndex, ...)`. Both vars are reset in `newChat()`.

`ChatHistory.save()` accepts an optional `toolCallsByTurn` map. When present, `messagesToMarkdown` injects a collapsible `> [!tool-use]-` callout immediately after each `## Assistant` heading. `markdownToMessages` strips these callouts before returning message content so they never pollute re-submitted conversation context.

### Skills System

The plugin supports a vault-native Skills feature. Each skill is a folder inside the configurable `skillsSettings.folder` (default `LLM-Skills`) containing a `SKILL.md` file.

#### Built-in skills

Three skills ship with the plugin and are seeded into the vault on first run (and whenever `reinitSkillRegistry` is called, e.g. after changing `rootVaultFolder`). They are defined in `src/Skills/BuiltinSkills.ts` as `BUILTIN_SKILLS: BuiltinSkillDef[]`. Seeding is non-destructive — existing files are never overwritten. The built-in skills are:

- **obsidian-markdown** — Obsidian Flavored Markdown syntax (wikilinks, callouts, embeds, properties). Content sourced from [kepano/obsidian-skills](https://github.com/kepano/obsidian-skills) (MIT).
- **obsidian-bases** — Obsidian Bases (`.base`) file format: filters, columns, formulas, views.
- **json-canvas** — JSON Canvas (`.canvas`) format: nodes, edges, groups, colors.

To add a new built-in skill, add a `BuiltinSkillDef` entry to the `BUILTIN_SKILLS` array in `BuiltinSkills.ts`. The `id` field becomes the folder name and skill id.

#### SKILL.md format

```yaml
---
name: My Skill
description: What this skill does
allowed-tools:
  - obsidian_read_note
  - obsidian_search
disable-model-invocation: false
argument-hint: "[target-note]"
---

## Instructions

<instruction body injected as system context when the skill is active>
```

- **`allowed-tools`**: restricts which ObsidianToolRegistry tools the AgentLoop can call. Empty = all tools allowed.
- **`disable-model-invocation`**: when `true`, the skill's instruction body is rendered directly as the assistant reply — no API call is made. Useful for template/canned-response skills.
- **`argument-hint`**: displayed grayed-out next to the skill name in the slash picker (e.g., `[target-note]`).
- **`{{args}}` substitution**: any `{{args}}` placeholder in the instruction body is replaced at send time with the text typed after the skill prefix (e.g., `/summarize-note My Note` → `{{args}}` becomes `"My Note"`). Applies to slash-invoked skills only (globally-enabled skills have no per-message args).

#### Key files

- **`src/Skills/SkillRegistry.ts`** — discovers and parses `SKILL.md` files; hot-reloads on vault `create/modify/delete/rename` events registered in `main.ts`.
- **`src/Plugin/Components/SkillsContainer.ts`** — per-skill enable/disable toggles (accessible via LLMSettingsModal → Skills, not from the chat header).
- **`src/Settings/LLMSettingsModal.ts`** — "Skills" nav item under Core Settings; lets the user configure the skills folder and global enable/disable toggles.

#### Invocation

Three ways to activate a skill:

1. **Slash command**: type `/skill-id` in the chat input. A floating picker appears listing all skills; selecting one inserts `/skill-id ` as inline text in the textarea. The prefix is parsed by `handleGenerateClick` and stripped before the API call. The picker only shows while the input matches `^\/[a-zA-Z0-9_-]*$` (no trailing space or message text).
2. **Plus button menu**: clicking the `+` button opens an Obsidian `Menu` with "Add file as context" and (if skills exist) "Add a skill". The "Add a skill" item opens a second Menu listing all skills; selecting one inserts `/skill-id ` into the textarea.
3. **Global enable**: toggle a skill on in Settings → Skills. Enabled skills' instructions are injected into every message across all views; their `allowed-tools` are unioned.

#### Slash menu implementation notes

- `ChatContainer.slashMenuEl` — the floating menu div, mounted on `document.body` with `position: fixed`. Stored as an instance variable so each `ChatContainer` only removes its own previous menu (not other views' menus). Cleaned up in `destroy()`.
- Menu is positioned via `requestAnimationFrame` after layout, using `promptContainer.getBoundingClientRect()` to compute `top = rect.top - menuHeight - 6px`.
- Do NOT use `document.querySelectorAll(".llm-slash-menu").forEach(el => el.remove())` — this would destroy other views' menus.
- Each item shows: icon | name + argument hint (`.llm-slash-menu-item-hint`, grayed out) | description | edit pencil button.
- The edit button uses `stopPropagation()` on its `mousedown` to prevent the parent item's selection handler from firing. It opens the skill's `SKILL.md` via `app.workspace.getLeaf(false).openFile(file)`.

#### Skill call display in chat UI and chat files

When a skill is active for a generation, it is recorded and shown:

- **In the chat UI**: a small `llm-skill-panel` banner (with `scroll-text` icon and skill name) appears above the assistant message, before any tool-call panel.
- **In saved chat files**: a `> [!tip]- Skill: <id>` callout is written immediately after the `## Assistant` heading (before tool-call callouts). Stripped by `markdownToMessages` before messages are re-submitted to the model.

**Data flow:**
- `ChatContainer.allSkillsByTurn: Map<number, string>` — turn index → skill id. Populated by `runAgentMode` (agent path) and `handleGenerateClick` (non-agent path). Cleared in `newChat()`.
- `ChatContainer.setSkillsByTurn(map)` — restores skill data when loading a conversation from a file. Called alongside `setToolCallsByTurn` in `Widget.ts`, `HistoryContainer.ts`, and `StatusBarButton.ts`.
- `ChatHistory.save()` accepts an optional `skillsByTurn?: Map<number, string>` 7th argument and serializes it via `renderSkillBlock`.
- `ChatHistory.load()` calls `parseSkillsFromBody()` to reconstruct the map and returns it as `skillsByTurn` on `LoadedChat`.

#### Icon convention

All skills-related UI uses the `scroll-text` lucide icon (previously `wand-sparkles`). This applies to skill item rows in `SkillsContainer`, the "Skills" nav item in `LLMSettingsModal`, the slash picker menu items, the `+` button's "Add a skill" menu item, and the `llm-skill-panel` indicator in chat messages. The Skills tab has been removed from the chat header — skill selection is via the slash command or `+` button instead.

#### AgentLoop integration

`AgentLoop` accepts an optional `allowedTools: string[]` 5th constructor argument. When non-empty, only tools in that list are exposed to the model. `ChatContainer.runAgentMode` passes `skillAllowedTools` built during skill resolution.

#### Settings persistence

`LLMPluginSettings.skillsSettings: SkillsSettings` — deep-merged on load with defaults `{ enabledSkills: {} }`. The skills folder is **not** stored in `skillsSettings`; it is derived as `plugin.skillsFolder` (getter): `plugin.settings.rootVaultFolder + "/Skills"`.

`LLMPluginSettings.rootVaultFolder: string` — top-level setting (default `"AI"`) shared across all AI features. Skills live at `<rootVaultFolder>/Skills`, Projects at `<rootVaultFolder>/Projects`, Memories at `<rootVaultFolder>/Memories`. Configurable via Settings → General → "Root vault folder". After changing it, both `plugin.reinitSkillRegistry()` and `plugin.reinitProjectManager()` are called to hot-reload from the new path.

### Memory System

The plugin supports a cross-session Memory feature. Memories are plain markdown files stored in the vault so users can read, edit, and delete them directly in Obsidian.

#### Vault hierarchy

```
<rootVaultFolder>/
  Memories/                          ← global (always recalled)
    <uuid>.md
  Assistants/<name>/memories/        ← recalled when assistant is active
    <uuid>.md
  Projects/<name>/memories/          ← recalled when project is active
    <uuid>.md
```

#### Memory file format

```yaml
---
created: <ISO date>
source: <"global" | assistant name | project name>
type: <"fact" | "preference" | "context">
---
<one-sentence memory content>
```

#### Key files

- **`src/Memory/MemoryService.ts`** — core service:
  - `extractAndSave(messages, scope, scopeName, callModel)` — calls the active model with a structured extraction prompt, writes individual `.md` files to the correct scope folder, skips duplicates (cosine similarity ≥ 0.92).
  - `recall(query, ctx, topK, indexer)` — queries the VaultIndexer restricted to active scope folders, returns a formatted context block.
  - `isMemoryFile(path)` — returns true for any path inside a memories folder (used for hot-reloading).
  - `loadMemoriesFromFolder(folder)` — reads and parses all `.md` files from a folder via adapter (bypasses Obsidian TFile cache).

#### Extraction

Extraction runs a single model call with a structured JSON prompt. The model returns `[{ type, content }]` objects. Each item is checked for semantic similarity against existing memories in the same scope before writing. Extraction is provider-agnostic — `ChatContainer.buildMemoryCallModel()` builds the right wrapper for the active provider (Claude, Gemini, OpenAI-compatible).

#### Recall

Before each send in `handleGenerateClick`, `MemoryService.recall()` searches the VaultIndexer (hybrid search, 70% cosine + 30% BM25) restricted to the active scope folders. Results are deduped by filePath and the top-k block is prepended to `pendingContextString` before the API call. A `llm-memory-panel` indicator appears under the assistant message when memories were injected.

#### Settings

`LLMPluginSettings.memorySettings: MemorySettings` — deep-merged on load:
- `enabled: boolean` — gates the entire feature (requires RAG to be enabled for recall).
- `extractionTrigger: "end-of-chat" | "manual"` — when to run extraction; surfaced as a toggle in the Memory settings tab.
- `recallTopK: number` — how many memory chunks to inject per send.
- `recallAlways: boolean` — **deprecated / unused**. Memory recall (`useMemory`) is now always `true` when `enabled` is true — there is no per-conversation toggle chip. The field is kept in the type for backwards compatibility with existing settings objects but is no longer read or surfaced in the UI.

#### /remember command

Typing `/remember [content]` in the chat input saves that exact string as a `fact` memory without a model call. The command is intercepted in `handleGenerateClick` before skill resolution. A confirmation message is shown in the chat. Also accessible via the `+` button menu as "Save a memory…" (only visible when memory is enabled). Duplicate check still runs — if the content is semantically similar to an existing memory it is skipped with a "already in memory" response.

#### UI integration in ChatContainer

- `useMemory: boolean` — always `true` when `memorySettings.enabled` is true; no toolbar button or chip. Can still be toggled off per-conversation via the `+` button menu as a power-user escape hatch.
- `extractMemories()` — called by the toolbar extract button or automatically at `newChat()` when trigger is `"end-of-chat"`.
- `appendMemoryIndicator(container)` — renders a `llm-memory-panel` banner on the assistant message when memories were recalled.
- `buildMemoryCallModel()` — builds a provider-specific `(system, user) => Promise<string>` wrapper for the extraction call.

#### Memory + RAG dependency

Memory recall requires `plugin.vaultIndexer` to be non-null (i.e. RAG must be enabled). Memory files are indexed automatically by the existing `vault.on('modify')` watcher in `main.ts`. `plugin.initMemoryService()` rebuilds the `MemoryService` using the same `EmbeddingService` configuration as RAG.

### Projects System

The plugin supports a Projects feature. Projects are named workspaces that scope the chat context: system instructions, pinned notes, and memory recall.

#### Vault hierarchy

```
<rootVaultFolder>/
  Projects/
    <project-id>/
      PROJECT.md             ← project definition (frontmatter + system instructions)
      memories/              ← project-scoped memory files (recalled alongside global)
```

#### PROJECT.md format

```yaml
---
name: My Project
description: One-line description
pinned-notes:
  - path/to/note.md
default-assistant: <assistant name>   # optional, future Assistants feature
created: <ISO date>
---

<system instructions — injected as system prompt prefix for every conversation>
```

#### Key files

- **`src/Projects/ProjectManager.ts`** — discovers and parses `PROJECT.md` files; hot-reloads on vault `create/modify/delete/rename` events registered in `main.ts`. Same pattern as `SkillRegistry`.
- **`src/Types/types.ts`** — `Project` and `ProjectSettings` types.

#### How it integrates

- `LLMPlugin.projectManager` is the singleton instance (always initialized, folder derived from `rootVaultFolder`).
- `LLMPlugin.settings.projectSettings.activeProjectId` (persisted) holds the active project id or `null`.
- `LLMPlugin.projectsFolder` getter returns `<rootVaultFolder>/Projects`.
- Switching projects does **not** auto-start a new chat; the project is set via `plugin.settings.projectSettings.activeProjectId` and the chip strip is refreshed via `chatContainer.syncChips()`.
- In `ChatContainer.handleGenerateClick()`, if a project is active:
  1. Pinned notes are read from vault and injected into `pendingContextString` as `# Pinned Project Notes` block.
  2. Project system instructions are injected as `# Project Instructions: <name>` block (prepended to context, after pinned notes).
  3. Memory recall passes `activeProject: project.name` to `MemoryContext` so project-scoped memories are included.
- Saved chat files get a `project: "<name>"` YAML field in frontmatter when a project is active.
- **Chat files are co-located with their project**: new chats saved while a project is active land in `<rootVaultFolder>/Projects/<projectId>/chats/` instead of the default chat folder. Adding a project to an existing chat moves the file there immediately; removing it moves it back to the default folder. Use `ChatHistory.moveToFolder()` and `ChatHistory.updateProjectField()` for this.
- **`ChatContainer.setActiveProject(projectId | null)`** is the single authority for changing the active project at runtime. It moves the file, patches frontmatter, updates `activeProjectId` in settings, and calls `syncChips()`. Never mutate `activeProjectId` directly in UI handlers — always call this method.
- **`ChatContainer.restoreProjectFromChat(filePath, metaProjectName?)`** is called after every chat file load (HistoryContainer, Widget, StatusBarButton). It detects project membership from the file path first (`Projects/<id>/chats/`), falls back to `meta.project` name matching, and clears `activeProjectId` if neither matches. This ensures the project chip always reflects the loaded chat.
- Project pinned notes appear as non-removable chips (dashed border, pin icon) in the chip strip above the chat input.
- **Project chip**: when a project is active, a `.llm-project-chip` chip appears first in the chip strip. It shows only the box icon at rest; on hover it expands (CSS `max-width` transition) to reveal the project name and a remove (×) button.
- **Project selection UI** — two entry points depending on chat state:
  - *New chat (no messages)*: "Add to project" submenu in the **+ button** menu (`addFilesButton` in `ChatContainer`).
  - *Started chat*: "Add to project" submenu in the **more-options menu** — chevron button on FAB/StatusBar headers; `more-horizontal` button on Widget/Modal (default) header.
- There is **no longer a project switcher pill** in the chat header — `buildProjectSwitcher` and `updateProjectSwitcher` have been removed from `Header.ts`.
- `LLMPlugin.reinitProjectManager()` is called when `rootVaultFolder` changes (Settings → General).
- Projects are managed (create/edit/delete/activate) via Settings → Features → Projects.

#### `projectSettings` persistence

`LLMPluginSettings.projectSettings: ProjectSettings` — deep-merged on load with defaults `{ activeProjectId: null }`.

### Assistants System

The plugin supports a vault-native Assistants feature. Assistants are user-defined AI personas stored as `ASSISTANT.md` files in the vault. This is **distinct from the existing OpenAI Assistants API integration** (`AssistantHandler.ts`/`AssistantsContainer.ts`) — do not modify those files.

#### Vault hierarchy

```
<rootVaultFolder>/
  Assistants/
    <assistant-id>/
      ASSISTANT.md             ← assistant definition
      memories/                ← assistant-scoped memory files
```

#### ASSISTANT.md format

```yaml
---
name: My Assistant
description: One-line description
provider: claude                   # informational only
model: claude-sonnet-4-6           # informational only
preferred-model: claude-sonnet-4-6 # auto-selected when this assistant is chosen in the dropdown
enabled-skills:                    # skill ids from AI/Skills/
  - summarize
  - create-note
allowed-tools:                     # ObsidianToolRegistry tool names
  - obsidian_read_note
  - obsidian_search
created: 2024-01-01T00:00:00.000Z
---

<system prompt — injected into context when this assistant is active>
```

#### Key files

- **`src/Assistants/AssistantManager.ts`** — discovers and parses `ASSISTANT.md` files; hot-reloads on vault `create/modify/delete/rename` events. Same adapter-based pattern as `SkillRegistry` and `ProjectManager`. Also has `createAssistant()` / `deleteAssistant()` helpers.
- **`src/Types/types.ts`** — `Assistant` and `AssistantSettings` types.

#### How it integrates

- `LLMPlugin.assistantManager` is the singleton instance (always initialized, folder derived from `rootVaultFolder`).
- `LLMPlugin.settings.assistantSettings.activeAssistantId` (persisted) holds the active assistant id or `null`.
- `LLMPlugin.assistantsFolder` getter returns `<rootVaultFolder>/Assistants`.
- In `ChatContainer.handleGenerateClick()`, if an assistant is active:
  1. Its `enabled-skills` are merged with globally-enabled skills (union).
  2. Its `allowed-tools` intersect with any skill-level tool restrictions (most restrictive wins).
  3. Its system prompt is injected as `# Assistant: <name>` block — positioned **after** project instructions (project is outer, assistant is inner).
  4. Memory recall passes `activeAssistant: assistant.id` to `MemoryContext`, so assistant-scoped memories are included.
- If no explicit assistant is set but the active project has a `default-assistant`, that assistant is auto-activated for the conversation.
- Memory extraction scope: project active → write to project memories; only assistant active → write to assistant memories; neither → global.
- Assistant selection is handled via the combined model+assistant dropdown in the chat input toolbar (not a header pill). The dropdown has two `<optgroup>` sections: "Models" and "Assistants". Selecting an assistant sets `activeAssistantId`, optionally switches to the assistant's `preferredModel`, and starts a new chat. Selecting a plain model clears the active assistant.
- `ChatContainer.syncAssistantDropdownOptions()` rebuilds the assistants optgroup on hot-reload; call it whenever `AssistantManager` reloads.
- `LLMPlugin.reinitAssistantManager()` is called when `rootVaultFolder` changes (Settings → General).
- Assistants are managed (create/edit/delete/activate) via Settings → Core Settings → Assistants.

#### Context injection order (from top of model context to bottom)

```
[Recalled memories]     ← prepended last, so they appear first
[Project instructions]  ← outer scope
[Assistant system prompt] ← inner persona
[Skill instructions]
[Vault / file context]
```

#### `assistantSettings` persistence

`LLMPluginSettings.assistantSettings: AssistantSettings` — deep-merged on load with defaults `{ activeAssistantId: null }`.

#### CSS classes

- `.llm-assistant-panel` — per-response indicator showing which assistant was active (analogous to `.llm-skill-panel` and `.llm-memory-panel`)

### Obsidian Agent

The Obsidian Agent is the single always-available primary agent — the equivalent of Linear's "Linear Agent." It knows the full vault, can invoke any enabled Skill, and can route to any configured Assistant for specialised work.

#### Entry points

When `obsidianAgentSettings.enabled` is true:
- **FAB** — `FAB.generateFAB()` sets `chatContainer.isObsidianAgent = true`
- **Status bar button** — `StatusBarButton.buildPopover()` sets `chatContainer.isObsidianAgent = true`
- **Command palette** — `open-obsidian-agent` command opens `ChatModal2(plugin, true)`
- **Modal (non-agent)** — `ChatModal2` also sets `isObsidianAgent` from the setting when opened without the flag

#### How agent mode works in ChatContainer

`ChatContainer.isObsidianAgent: boolean` (default `false`) enables agent mode:
1. In `handleGenerateClick`, after memory recall, `ObsidianAgent.buildSystemPrompt()` is appended to `pendingContextString` (memories remain first in context; agent prompt follows).
2. In `runAgentMode`, when `isObsidianAgent`, an `extraSetup` callback is passed to `AgentLoop` that calls `ObsidianAgent.registerTools(registry)` — this registers the `invoke_assistant` dynamic tool.
3. When `invoke_assistant` fires, `onToolResult` captures the assistant name into `agentRoutedAssistantThisTurn`.
4. After generation, `appendAgentRoutingIndicator(container, assistantName)` adds a `.llm-agent-routing-panel` banner below the response.
5. `historyPushToFile` tags new files with `agent: true` in frontmatter via `ChatHistory.save(... isAgent=true)`.

#### `invoke_assistant` tool

Defined and registered in `ObsidianAgent.registerTools(registry: ObsidianToolRegistry)`. Only registered when there are agent-available assistants. Execution returns the assistant's system prompt + task as a string — the main agent loop continues from that persona. Routing is expressed entirely through the system prompt, not a separate sub-AgentLoop.

#### System prompt composition

`ObsidianAgent.buildSystemPrompt()` is **async** — it reads the vault file at `obsidianAgentSettings.agentGuidanceFile` if configured. Auto-generates from live state:
1. Base identity paragraph
2. Available Skills list (filtered by `obsidianAgentSettings.availableSkills`)
3. Available Assistants list with `invoke_assistant` instructions (filtered by `obsidianAgentSettings.availableAssistants`)
4. Projects in the vault
5. Chat history folder paths (when `chatHistoryEnabled`)
6. Agent guidance file content (read from vault at `agentGuidanceFile` path)

#### Vault guidance files (two distinct concepts)

The plugin exposes two vault-native guidance files:

| File | Setting key | Scope | Injected when |
|------|-------------|-------|---------------|
| `AI/OBSIDIAN-AGENT.md` (default empty) | `obsidianAgentSettings.agentGuidanceFile` | Obsidian Agent only | Agent turns — appended inside `buildSystemPrompt()` |
| `AI/AGENTS.md` (default path) | `LLMPluginSettings.agentsFilePath` | Every conversation | All sends — prepended to `pendingContextString` before memory recall |

- **Agent guidance file** — tells the Obsidian Agent how to navigate this specific vault (structure, conventions, off-limits folders, routing rules). Configured in Settings → Obsidian Agent → "Agent Guidance".
- **General instructions file** (AGENTS.md) — a global system prompt injected into every conversation regardless of model or assistant. Configured in Settings → General → "General Instructions".
- Both use the shared `renderGuidanceFilePicker()` helper in `LLMSettingsModal` — a path text input + smart "Open"/"Create" button.
- `plugin.refreshAllChips()` re-renders chips in all live views (FAB, StatusBar, Widget). Call after the `agentsFilePath` setting changes.
- **Guidance files are no longer shown as chips in the input strip.** They appear instead in a "Guidance" section in the Chat Details panel (`ChatDetailsView` / inline widget sidebar). `ChatDetailsState.guidanceFiles` carries `{ name, path, icon }` entries — `"book-open"` for AGENTS.md (always when configured), `"scroll-text"` for OBSIDIAN-AGENT.md (only when Obsidian Agent is active). Rendered by `renderGuidanceSection()` in `ChatDetailsRenderer.ts`.

#### Settings

`LLMPluginSettings.obsidianAgentSettings: ObsidianAgentSettings` — deep-merged on load:
- `enabled: boolean` — gates the feature; when toggled, FAB is regenerated
- `enableWebSearch: boolean` — placeholder for future web search support
- `availableSkills: Record<string, boolean>` — per-skill opt-in/out; missing keys = available
- `availableAssistants: Record<string, boolean>` — per-assistant opt-in/out; missing keys = available
- `agentGuidanceFile: string` — vault-relative path to the agent's guidance note (empty = disabled)

`LLMPluginSettings.agentsFilePath: string` — vault-relative path to the general instructions file (default `"AI/AGENTS.md"`; empty = disabled).

Settings UI lives in `LLMSettingsModal` under Features → Obsidian Agent (agent guidance) and General → General Instructions (AGENTS.md).

#### Dynamic tool registration

`ObsidianToolRegistry.registerDynamicTool(def, executor)` adds tools at runtime without modifying `ALL_TOOL_DEFINITIONS`. `AgentLoop` accepts an optional `extraSetup?: (registry) => void` 8th constructor argument that's called after the registry is created, and an optional `chatHistory?: ChatHistory` 9th argument that is forwarded to `ObsidianToolRegistry` for the `get_chat_history` tool.

#### Chat history access (`get_chat_history` tool)

The agent can read saved conversations via the `get_chat_history` static tool (defined in `ALL_TOOL_DEFINITIONS`). `ObsidianToolRegistry` accepts an optional `chatHistory?: ChatHistory` 3rd constructor param; `AgentLoop` accepts it as a 9th param and forwards it. `ChatContainer.runAgentMode` passes `this.plugin.chatHistory` when `chatHistoryEnabled` is true.

- **action `list`**: calls `ChatHistory.list()`, returns filenames + mtimes, supports `limit`, `filter_project`, and `filter_agent` filters.
- **action `load`**: calls `ChatHistory.load(path)`, returns full metadata + parsed message turns as readable markdown.

`ObsidianAgent.buildSystemPrompt()` injects a `## Chat History` section (when `chatHistoryEnabled`) describing the default chat folder and project chat paths, so the agent knows where to look without guessing.

#### History tagging

Agent conversations are saved to the same `ChatHistory` folder as regular chats but with `agent: true` in YAML frontmatter. `ChatFileMeta.agent?: boolean` is the field; `buildFrontmatter` emits it; `load()` returns it in `ChatFileMeta`.

#### CSS classes

- `.llm-agent-routing-panel` — routing indicator below the response when `invoke_assistant` was called
- `.llm-agent-routing-panel-icon` — icon element (uses `waypoints` Lucide icon, accent-coloured)
- `.llm-agent-routing-panel-label` — "Routed to <Assistant Name>" text
- `.llm-agent-guidance-textarea` — textarea in settings for vault guidance input
- `.llm-token-usage` — token count indicator shown below each response when the provider reports usage (Claude, OpenAI, Gemini). Format: "↑ N ↓ N tokens" (input / output). Rendered by `appendTokenUsage(container, inputTokens, outputTokens)` in `ChatContainer`; cleared in `newChat()`.

### Web Search (SearXNG)

The plugin supports web search via a self-hosted [SearXNG](https://searxng.github.io/searxng/) instance. The feature is gated behind `searxngSettings.enabled` and exposes a `web_search` tool to any tool-capable model (Claude, GPT-4, Gemini, etc.).

#### Architecture

- **`src/WebSearch/SearxngService.ts`** — service class wrapping the SearXNG JSON API (`GET /search?q=<query>&format=json`). Key methods:
  - `search(query, numResults?)` — calls SearXNG with `throw: false` so HTTP errors (429, 403, 5xx) are caught and converted to descriptive `SearxngHttpError` instances rather than opaque exceptions. Adds browser-like `User-Agent` / `Accept` headers to avoid bot-detection rate limits.
  - `checkHealth()` — probes `/healthz`, falls back to a minimal search request. Returns `true` even on 429 (instance is up, just rate-limited).
  - `SearxngService.formatResults(results)` — static formatter; renders results as `**N. [Title](URL)**` markdown hyperlinks so the model naturally reproduces clickable citations in its response.
  - `SearxngHttpError` — typed error class with a `.status` field; 429 includes a human-readable explanation about underlying engine rate limits.

#### Settings

`LLMPluginSettings.searxngSettings: SearxngSettings` — deep-merged on load:
- `enabled: boolean` — gates the entire feature; toggling calls `plugin.initSearxngService()`.
- `host: string` — base URL of the SearXNG instance (default `http://localhost:8080`).
- `maxResults: number` — maximum results returned per query (1–10, default 5).

`LLMPlugin.searxngService: SearxngService | null` — null when disabled or host is blank. Rebuilt by `initSearxngService()` after any settings change.

#### Tool integration

`web_search` is defined in `ALL_TOOL_DEFINITIONS` (with `requiresWebSearch: true` so Settings → Tools shows a warning when SearXNG is not enabled). The executor in `ObsidianToolRegistry.executeTool()` calls `searxngService.search()` inside its own try/catch and returns the descriptive error message to the model on failure — never throws.

`AgentLoop` accepts `searxngService?: SearxngService | null` as its 11th constructor argument and forwards it to `ObsidianToolRegistry` as the 4th constructor argument. `ChatContainer.runAgentMode` passes `this.plugin.searxngService`.

#### Web sources panel

After a `web_search` tool call, `ChatContainer` parses `**N. [Title](URL)**` links from the result string via regex and stores them in `pendingWebSources: { title, url }[]`. After generation, `appendWebSourcesPanel()` renders a collapsible `<details class="llm-web-sources">` panel below the response — matching the existing RAG sources panel pattern. Cleared in `newChat()` and on error.

#### Settings UI

"Web Search" group appears in Settings → Obsidian Agent (visible only when the agent is enabled) with:
- Enable toggle (calls `initSearxngService()` on change and re-renders the tab)
- Host text input + **Test connection** button (calls `checkHealth()`, shows a `Notice`)
- Max results slider (1–10)

Tools → Available Tools shows a `⚠ Requires Web Search (SearXNG)` note next to `web_search` when `searxngSettings.enabled` is false.

#### Common setup issues

The official SearXNG Docker Compose image (`searxng/searxng:latest` + Valkey sidecar) ships with two settings that must be changed in the **host-mounted** `settings.yml` (typically `~/Downloads/searxng-setup/searxng/settings.yml`):

```yaml
server:
  limiter: false     # default true — causes 429 for non-browser clients

search:
  formats:
    - html
    - json           # must be added — default omits json, causing 403
```

After editing, `docker restart searxng`. The `limiter` key is patched by `sed -i '' 's/limiter: true/limiter: false/'`; the `json` format must be added manually under `formats:`.

#### CSS classes

- `.llm-web-sources` — outer `<details>` wrapper (border-top, margin)
- `.llm-web-sources-summary` — clickable summary row with globe icon and `›` chevron
- `.llm-web-sources-icon` — `<span>` holding the Lucide `globe` icon
- `.llm-web-sources-list` — `<ul>` of result links
- `.llm-web-source-link` — individual `<a>` link (accent colour, opens in new tab)

### Key Files

- `src/Plugin/ObsidianAgent/ObsidianAgent.ts` - System prompt builder, `registerTools()`, `invoke_assistant` tool logic
- `src/WebSearch/SearxngService.ts` - SearXNG API wrapper, `SearxngHttpError`, `formatResults()`
- `src/Assistants/AssistantManager.ts` - Assistant discovery, parsing, hot-reload, and create/delete helpers
- `src/Projects/ProjectManager.ts` - Project discovery, parsing, hot-reload, and create/delete helpers
- `src/Memory/MemoryService.ts` - Memory extraction, deduplication, recall, and vault persistence
- `src/Types/types.ts` - TypeScript interfaces (ChatParams, ImageParams, RAGSettings, MemorySettings, ProjectSettings, AssistantSettings, ObsidianAgentSettings, etc.)
- `src/utils/constants.ts` - Provider/model/endpoint constants (includes `images`, `chat`, `messages`, `assistant`, `claudeCodeEndpoint`, etc.)
- `src/utils/models.ts` - Model configuration definitions
- `src/utils/utils.ts` - API validation and helper functions

### Constants Convention

All endpoint type strings live in `src/utils/constants.ts` and must be imported as constants rather than compared against raw string literals. The full set of endpoint constants is: `chat`, `messages`, `images`, `claudeCodeEndpoint`. Provider type constants are: `openAI`, `claude`, `claudeCode`, `gemini`, `mistral`, `ollama`, `lmStudio`, `GPT4All`.

### CSS / Styling Convention

- Always use Obsidian CSS variables (`--size-4-2`, `--font-ui-small`, `--text-muted`, `--interactive-accent`, etc.) instead of hardcoded px/em/color values.
- Use `--icon-xs` / `--icon-s` for icon sizes rather than raw pixel values.
- Component-specific styles belong in `styles.css` as named classes — never use inline `element.style.*` assignments in TypeScript (use `.addClass()` with a CSS class instead).
- `FileSelector.ts` uses the `.llm-file-selector-*` family of classes defined in `styles.css`.

## Build Configuration

- **esbuild** bundles to CommonJS format targeting ES2018
- External dependencies: `obsidian`, `electron`, `@codemirror/*`, Node builtins
- SVG files loaded inline via esbuild loader
- TypeScript configured with strict null checks, baseUrl `src`
