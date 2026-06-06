---
paths:
  - "src/Assistants/**"
---

# Assistants System

Vault-native AI personas as `ASSISTANT.md` files.

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
