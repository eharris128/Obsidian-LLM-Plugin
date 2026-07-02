# CLAUDE.md

Guidance for Claude Code when working in this repository — an Obsidian plugin providing LLM chat interfaces for OpenAI, Anthropic Claude, Google Gemini, Mistral, and local Ollama / LM Studio / GPT4All.

## Build Commands

```bash
npm run dev      # watch mode (esbuild)
npm run build    # production build (tsc type-check + esbuild bundle)
npm run lint     # eslint src --max-warnings=0 — obsidianmd preset + type-checked rules; must stay clean (scorecard parity)
npm run version  # bump manifest.json and versions.json
npm run test:e2e # E2E suite — real sandboxed Obsidian via wdio-obsidian-service (see test/README.md)
```

Output bundles to `main.js` in the root. esbuild targets CommonJS/ES2018; `obsidian`, `electron`, `@codemirror/*`, and Node builtins are external; SVGs load inline. TypeScript is `strict: true`, baseUrl `src`. The esbuild banner defines an `import.meta.url` shim (`__import_meta_url`) — `@anthropic-ai/claude-agent-sdk` calls `createRequire(import.meta.url)` at module scope, which would otherwise throw on load in CJS output. Don't remove the `define`/banner pair.

### Node/Electron access pattern (mobile safety — scorecard-enforced)

The plugin ships `isDesktopOnly: false`; **nothing in the load graph may touch Node or Electron.** Every access is lazy and guarded by the literal `Platform.isDesktop` in a shape `obsidianmd/no-nodejs-modules` recognizes: an `if (!Platform.isDesktop) throw/return` as the *first statement of the enclosing function*, an `if (Platform.isDesktop) { … }` block, `&&`, or a ternary. Pattern by module kind:

- **Bundled dependency (`@anthropic-ai/claude-agent-sdk`)** — desktop-gated dynamic `import()` (esbuild wraps it in a lazy `__esm` closure). Never add a static value-import of the SDK anywhere — one surviving import silently re-inlines its module-scope Node requires into the load path with no build error (type-only imports are fine). After touching that area, verify the bundle: the only `init_sdk*()` call for the agent SDK must sit inside `Promise.resolve().then(...)`.
- **External modules (Node builtins, `electron`)** — guarded `require()` typed `as typeof import("x")`, each with a described `eslint-disable-next-line @typescript-eslint/no-require-imports -- …`. **Never convert these to dynamic `import()`** — esbuild leaves external dynamic imports as native `import()` in CJS output, which rejects at runtime.
- **`require("__ORT_ABS_PATH__")`** (`EmbeddingService`) — literal string is a build contract; `esbuild.config.mjs` `patchBundle()` rewrites it.

Desktop-only agent tools (`read_local_file`, `list_local_folder`, `run_shell_command`) are hidden from `getTools()` on mobile *and* guarded in their executors; `ObsidianToolRegistry.isToolAvailable()` must be checked before the permission gate so mobile users never see a permission card for a tool that cannot run.

E2E conventions live in `test/README.md` — notably: never point `wdio.conf.mts` `plugins:` at `"."` (the service copies `data.json` — real API keys — into test vaults; always stage via `scripts/stage-plugin.mjs`), and never hardcode the plugin id in specs (read `PLUGIN_ID` from `test/specs/helpers.ts`).

## Architecture Overview

### Entry point

`src/main.ts` — `LLMPlugin` class: initializes platform abstractions (Desktop/Mobile in `src/services/`), loads settings (`loadData`/`saveData`), registers commands/views, initializes MessageStore, History, and FAB.

### View architecture (four UIs, shared components)

- **Modal** — `src/Plugin/Modal/ChatModal2.ts`
- **Widget** (tab view) — `src/Plugin/Widget/Widget.ts`
- **FAB** — `src/Plugin/FAB/FAB.ts`
- **StatusBarButton** — `src/Plugin/StatusBar/StatusBarButton.ts` — "Ask AI" popover; uses `viewType: "floating-action-button"` and shares `fabSettings` with the FAB. The popover is built once on `generate()`, so call `chatContainer.syncModelDropdown()` whenever it is shown.

All compose shared components from `src/Plugin/Components/`: `Header.ts` (tab nav), `ChatContainer.ts` (messages, input, API calls), `HistoryContainer.ts`, `SettingsContainer.ts`.

### Multiple chat widget tabs

Multiple `WidgetView` instances can be open at once, each owning its own `ChatContainer` + `MessageStore` + chat file path (fully isolated conversations).

- `new-chat-widget` command always creates a fresh tab; `open-LLM-widget-tab` and the ribbon icon use focus-or-open-one-tab.
- `LLMPlugin.lastFocusedWidgetLeaf` is updated on `active-leaf-change`; `openChatFileInWidget()` / `activateTab()` prefer it so "open chat file" lands in the last-used widget.
- `ChatsSidebar.onOpenFile` callback: `WidgetView.onOpen()` sets it to `this.loadChatFile` so sidebar rows load into *that* widget. The standalone `ChatsView` still routes via `plugin.openChatFileInWidget()`.
- **Known limitation:** all widget tabs share `plugin.settings.widgetSettings`; model changes don't push reactively to other tabs' dropdowns. v2: per-view `ViewSettings` clone.

### State management

- **MessageStore** (`src/Plugin/Components/MessageStore.ts`) — pub/sub message state; synchronizes views. `setMessages` stores a shallow copy (`[...messages]`) so later `addMessage` pushes can't mutate the caller's array (notably legacy `promptHistory[n].messages`).
- **HistoryHandler** (`src/History/HistoryHandler.ts`) — legacy in-settings history; superseded by file-based `ChatHistory` when `chatHistoryEnabled: true` (the default).

### Message flow

Input → `handleGenerateClick()` → message added to MessageStore (notifies subscribers) → provider API call → streaming UI updates → saved to History.

**Context injection order** (top → bottom): recalled memories → project instructions → assistant system prompt → skill instructions → vault/file context.

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

- `openai` SDK — OpenAI chat/images; also Mistral (`https://api.mistral.ai/v1`), Ollama (`http://localhost:11434/v1`, models via `/api/tags`), LM Studio (`http://localhost:1234/v1`, models via `/v1/models`, placeholder key `"lm-studio"`).
- `@anthropic-ai/sdk` — Claude + Claude Code (agent SDK).
- `@google/generative-ai` — Gemini.
- GPT4All — local server on port 4891.

## Feature Systems — details in `.claude/rules/`

Each feature has a path-scoped rules file under `.claude/rules/` that loads automatically when its source files are read. **Working on a feature's integration points elsewhere (e.g. its hooks in `ChatContainer.ts` or `main.ts`)? Read the rule file directly first.**

| Feature | Core code | Rule file |
|---------|-----------|-----------|
| RAG / Vault Search — embeddings, hybrid search, agent tools | `src/RAG/` | `rag-vault-search.md` |
| Chat file format — tool-call & skill callouts in saved chats | `src/services/ChatHistory.ts` | `chat-file-format.md` |
| Skills — vault-native `SKILL.md`, slash commands | `src/Skills/` | `skills.md` |
| Memory — cross-session memories, `/remember`, recall | `src/Memory/` | `memory.md` |
| Projects — workspaces, pinned notes, chat co-location | `src/Projects/` | `projects.md` |
| Assistants — vault-native `ASSISTANT.md` personas | `src/Assistants/` | `assistants.md` |
| Obsidian Agent — primary agent, guidance files, `invoke_assistant` | `src/Plugin/ObsidianAgent/` | `obsidian-agent.md` |
| Web Search — SearXNG `web_search` tool, sources panel | `src/WebSearch/` | `web-search.md` |
| Whisper — voice input + file transcription, Python sidecar | `src/Whisper/` | `whisper.md` |
| Chats Panel — `ChatsView` + `ChatsSidebar`, row menu | `src/Plugin/ChatsView/` | `chats-panel.md` |
| Chat Details Panel — live context sidebar | `src/Plugin/ChatDetailsView/` | `chat-details.md` |
| Feature gates — `featureSettings` toggles in settings modal | `src/Settings/` | `feature-gates.md` |
| DOM visibility & inline styles — `.llm-hidden`, native hide/show, dynamic-only `style.*` | `src/Plugin/`, `src/Settings/`, `styles.css` | `obsidian-styling.md` |

Shared conventions across features: Skills/Projects/Assistants/Memories folders all derive from `rootVaultFolder` (default `"AI"`); managers (`SkillRegistry`, `ProjectManager`, `AssistantManager`) follow the same discovery/parsing/hot-reload pattern and have `reinit*()` methods called on `rootVaultFolder` change; all settings sub-objects are deep-merged in `loadSettings()`.

## Known Pitfalls

### `view.addAction()` survives hot-reloads — always scrub before adding

`addAction()` appends to a persistent DOM element that survives plugin hot-reloads, while any "already added?" tracking variable resets on every load — so naive re-adding duplicates the button. Before calling `addAction()` for any button with a custom class, query the view's container for that class and `.remove()` any existing element, then `addAction()` and `btn.addClass(...)`. The custom class is load-bearing — never skip it.

### FAB settings indexing

Always use `getSettingType("floating-action-button") as "fabSettings"` for a typed `LLMPluginSettings` key — never the raw string as an index (TS7053).

### `MarkdownRenderer.render` — use `this`, not `this.plugin`

`ChatContainer extends Component`. Pass `this` as the 5th `Component` argument to `MarkdownRenderer.render()`, never `this.plugin` — the plugin's lifecycle is the whole session, so rendered children never get cleaned up and Obsidian's automated review flags it. `ChatContainer` calls `this.load()` in its constructor and `this.unload()` in `destroy()`.

### Slash menu scoping

`ChatContainer.slashMenuEl` (floating menu on `document.body`, `position: fixed`) is an instance variable so each container removes only its own menu. Do NOT `document.querySelectorAll(".llm-slash-menu").forEach(el => el.remove())` — that destroys other views' menus. Cleaned up in `destroy()`.

## Obsidian Compliance Conventions

Keep the plugin aligned with Obsidian's community-plugin review. `npm run lint` guards what it can; the rest is convention.

- **Logging** — never call `console.*` directly. Use the singleton `logger` from `src/utils/logger.ts`: `logger.debug/log/info` are stripped from production builds (gated on the esbuild-injected `__DEV__`), `logger.warn/error` always emit with an `[LLM]` prefix. ESLint's `no-console: warn` flags raw console; `logger.ts` is the only exemption.
- **DOM visibility & inline styles** — toggle visibility with the `.llm-hidden` class, never `el.style.display`; reserve inline `el.style.*` for genuinely dynamic values. Full rules in `.claude/rules/obsidian-styling.md` (auto-loads for `src/Plugin/**`, `src/Settings/**`, `styles.css`).
- **Vault paths** — wrap user-supplied / derived vault paths in `normalizePath()` (the `rootVaultFolder` folder getters in `main.ts` do this).
- **No `as any` — use `src/Types/obsidian-internals.ts`** — undocumented Obsidian internals (`app.setting`, `app.commands`, `app.internalPlugins`, `workspace.rightSplit`, desktop `vault.adapter` base paths, `MenuItem.setSubmenu()`) are accessed via `as unknown as <Interface>` against the typed shapes in `src/Types/obsidian-internals.ts` (the review preset bans `no-explicit-any` disables). Add missing members there rather than reaching for `any`; prefer `instanceof TFile` over casting for vault files. Electron picker/dialog results get minimal local structural interfaces (`@types/electron` is deliberately not installed).

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
- Custom classes go in `styles.css` with the `llm-` prefix. Never inline `element.style.*` in TypeScript — use `.addClass()` with a named class; toggle visibility via the `.llm-hidden` utility (not `style.display`). Inline `el.style.*` is for genuinely dynamic values only (computed sizes/positions). See `.claude/rules/obsidian-styling.md`.
- Writing hover/focus/active states for a list row? Stop — use `tree-item-self`, which already has them.

## Key Files

- `src/Plugin/ObsidianAgent/ObsidianAgent.ts` — system prompt builder, `registerTools()`, `invoke_assistant`
- `src/WebSearch/SearxngService.ts` — SearXNG wrapper, `SearxngHttpError`, `formatResults()`
- `src/Assistants/AssistantManager.ts` / `src/Projects/ProjectManager.ts` — discovery, parsing, hot-reload, create/delete
- `src/Memory/MemoryService.ts` — memory extraction, dedup, recall, persistence
- `src/services/AgentLoop.ts` / `src/services/ObsidianToolRegistry.ts` — agent tool loop and tool definitions
- `src/Types/types.ts` — TypeScript interfaces (ChatParams, ImageParams, RAGSettings, MemorySettings, ProjectSettings, AssistantSettings, ObsidianAgentSettings, …)
- `src/utils/constants.ts` — provider/model/endpoint constants
- `src/utils/models.ts` — model configuration definitions
- `src/utils/utils.ts` — API validation and helpers

## Constants Convention

All endpoint type strings live in `src/utils/constants.ts` and must be imported as constants — never compared against raw string literals. Endpoint constants: `chat`, `messages`, `images`, `claudeCodeEndpoint`. Provider constants: `openAI`, `claude`, `claudeCode`, `gemini`, `mistral`, `ollama`, `lmStudio`, `GPT4All`.
