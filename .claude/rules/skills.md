---
paths:
  - "src/Skills/**"
  - "src/Plugin/Components/SkillsContainer.ts"
---

# Skills System

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
