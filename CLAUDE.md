# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm run dev      # Start development with watch mode (esbuild watches for changes)
npm run build    # Production build (TypeScript type-check + esbuild bundle)
npm run version  # Bump version in manifest.json and versions.json
```

Output is bundled to `main.js` in the root directory.

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

### State Management

- **MessageStore** (`src/Plugin/Components/MessageStore.ts`) - Pub/sub pattern for in-memory message state; synchronizes all views
- **Settings** (in `main.ts`) - Persisted configuration via Obsidian's `loadData`/`saveData`
- **HistoryHandler** (`src/History/HistoryHandler.ts`) - Manages chat history (max 10 conversations)
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

### RAG / Vault Search

The plugin supports semantic search over the user's vault via three classes in `src/RAG/`:

- **`VectorStore.ts`** — Persists embeddings as a flat JSON file (path passed via constructor). Provides cosine similarity search and incremental updates (skips files whose `mtime` hasn't changed). `save()` ensures the parent directory exists before writing — always use `vault.adapter.mkdir()` guard before any `adapter.write()` to a plugin-relative path, as the directory may not exist on fresh installs. **Important**: always call `store.ensureLoaded()` (or `store.load()`) before calling `store.upsert()` or `store.save()` outside of `indexVault()` — otherwise a partial in-memory state will overwrite the full on-disk index. `VaultIndexer.indexFile()` calls `ensureLoaded()` for this reason.
- **`EmbeddingService.ts`** — Provider-agnostic embedding generation. Supports OpenAI (`text-embedding-3-small`), Gemini (`text-embedding-004`), Ollama, and LM Studio (all via the OpenAI-compatible `/v1/embeddings` endpoint). LM Studio calls must pass `encoding_format: "float"` explicitly. Reuses API keys/hosts already stored in plugin settings.
- **`VaultIndexer.ts`** — Orchestrates indexing (chunking by paragraph, ~1500 chars per chunk with file path + heading prefix) and exposes `semanticSearch(query, topK)` which returns a formatted markdown context block. Calls `EmbeddingService.checkOllamaModel()` before indexing to surface a clear pull-command error if the Ollama model isn't available.

**How it integrates:**
- `LLMPlugin.vaultIndexer` is the singleton instance; call `plugin.initVaultIndexer()` after any RAG setting change.
- `LLMPlugin` registers `vault.on('modify')`, `vault.on('delete')`, and `vault.on('rename')` events to keep the index incrementally up-to-date. Modify events are debounced (2 s) to avoid hammering the embedding API during rapid autosaves.
- `ObsidianToolRegistry` receives the `VaultIndexer` and exposes a `search_vault_semantic` tool (`risk: "safe"`). Tool-capable models (Claude, GPT-4, Gemini, Ollama, Mistral) call this autonomously via `AgentLoop`.
- `AgentLoop` fires `AgentCallbacks.onToolResult(toolName, input, result)` after each successful tool execution — `ChatContainer` uses this to (a) capture `search_vault_semantic` results and populate the cited sources panel, and (b) record the call in `pendingToolCalls` for inclusion in the saved chat file.
- `ChatContainer` has a `useVaultSearch` toggle (toolbar button, always visible when RAG is enabled) that pre-fills `pendingContextString` with top-k results — a reliable manual fallback especially for Ollama/LM Studio/Mistral models whose tool-calling support varies per model. After generation, a collapsible "Sources" panel (`<details class="llm-rag-sources">`) is appended listing the contributing files as clickable links.
- Search uses **hybrid scoring**: 70% cosine similarity + 30% BM25 keyword score. BM25 IDF is computed at search time across the in-memory corpus. The `VectorStore.hybridSearch()` method handles both; `VectorStore.search()` delegates to it with full vector weight for pure semantic use.
- RAG settings live under `plugin.settings.ragSettings` (`RAGSettings` type in `types.ts`) and are configured in `LLMSettingsModal` under the "Vault Search" tab.

#### Tool call recording in chat files

`ChatContainer` tracks tool calls via two instance vars: `pendingToolCalls: ToolCallRecord[]` (accumulates during the current agent turn) and `allToolCallsByTurn: Map<number, ToolCallRecord[]>` (keyed by 0-based assistant-message index). At the start of `runAgentMode` the current assistant-message count is captured as `turnIndex`; `onToolResult` pushes to `pendingToolCalls`; after the turn completes the pending calls are committed to `allToolCallsByTurn.set(turnIndex, ...)`. Both vars are reset in `newChat()`.

`ChatHistory.save()` accepts an optional `toolCallsByTurn` map. When present, `messagesToMarkdown` injects a collapsible `> [!tool-use]-` callout immediately after each `## Assistant` heading. `markdownToMessages` strips these callouts before returning message content so they never pollute re-submitted conversation context.

### Skills System

The plugin supports a vault-native Skills feature. Each skill is a folder inside the configurable `skillsSettings.folder` (default `LLM-Skills`) containing a `SKILL.md` file.

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
- `recallAlways: boolean` — when true, `useMemory` initialises as `true` in every new `ChatContainer` and resets to `true` on `newChat()`, making recall opt-out rather than opt-in.

#### /remember command

Typing `/remember [content]` in the chat input saves that exact string as a `fact` memory without a model call. The command is intercepted in `handleGenerateClick` before skill resolution. A confirmation message is shown in the chat. Also accessible via the `+` button menu as "Save a memory…" (only visible when memory is enabled). Duplicate check still runs — if the content is semantically similar to an existing memory it is skipped with a "already in memory" response.

#### UI integration in ChatContainer

- `useMemory: boolean` — per-view toggle, persists within the session. Toggled via the brain-icon toolbar button.
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
- Switching projects (via the header pill) calls `chatContainer.newChat()` to start fresh under the new project.
- In `ChatContainer.handleGenerateClick()`, if a project is active:
  1. Pinned notes are read from vault and injected into `pendingContextString` as `# Pinned Project Notes` block.
  2. Project system instructions are injected as `# Project Instructions: <name>` block (prepended to context, after pinned notes).
  3. Memory recall passes `activeProject: project.name` to `MemoryContext` so project-scoped memories are included.
- Saved chat files get a `project: "<name>"` YAML field in frontmatter when a project is active.
- Project pinned notes appear as non-removable chips (dashed border, pin icon) in the chip strip above the chat input.
- The project switcher pill in the chat header shows the active project name or "No project"; clicking opens a menu to switch.
- `LLMPlugin.reinitProjectManager()` is called when `rootVaultFolder` changes (Settings → General).
- Projects are managed (create/edit/delete/activate) via Settings → Features → Projects.

#### `projectSettings` persistence

`LLMPluginSettings.projectSettings: ProjectSettings` — deep-merged on load with defaults `{ activeProjectId: null }`.

### Key Files

- `src/Projects/ProjectManager.ts` - Project discovery, parsing, hot-reload, and create/delete helpers
- `src/Memory/MemoryService.ts` - Memory extraction, deduplication, recall, and vault persistence
- `src/Types/types.ts` - TypeScript interfaces (ChatParams, ImageParams, RAGSettings, MemorySettings, ProjectSettings, etc.)
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
