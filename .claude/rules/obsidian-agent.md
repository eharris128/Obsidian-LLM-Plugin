---
paths:
  - "src/Plugin/ObsidianAgent/**"
---

# Obsidian Agent

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
