---
paths:
  - "src/Projects/**"
---

# Projects System

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
