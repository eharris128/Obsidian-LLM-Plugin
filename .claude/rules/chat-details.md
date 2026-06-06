---
paths:
  - "src/Plugin/ChatDetailsView/**"
---

# Chat Details Panel (`ChatDetailsView`)

`src/Plugin/ChatDetailsView/ChatDetailsView.ts` — right-sidebar `ItemView` (`CHAT_DETAILS_VIEW_TYPE = "llm-chat-details-view"`) showing live context: model/assistant, recalled memories, context files, guidance files.

- **State is pushed in** by `ChatContainer.pushChatDetailsState()` — the view holds no domain logic. Push points: `syncChips()`, `syncModelDropdown()`, after memory recall, `newChat()` (clears state).
- `plugin.getChatDetailsView()` returns the open instance or `null`; `plugin.activateChatDetailsPanel()` opens it (`open-chat-details-panel` command).
- `ChatDetailsState`: `modelLabel`, `isAssistant`, `assistantId`, `projectName`, `activeProject: { id, name, filePath, folderPath } | null`, `recalledMemories: string[]`, `contextFiles`, `guidanceFiles: { name, path, icon }[]`.
- `activeProject` powers an "Active Project" section: PROJECT.md row (opens in leaf) + folder row (revealed via `internalPlugins.file-explorer.revealInFolder`).
- Recalled memories are parsed from the `# Recalled Memories` block returned by `MemoryService.recall()` (lines starting `"- "`).
- `detailsBodyEl` (not `contentEl`) is the scrollable render target. CSS prefix `.llm-chat-details-*`.
