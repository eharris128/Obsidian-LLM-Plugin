---
paths:
  - "src/Plugin/ChatsView/**"
  - "src/Plugin/Components/ChatsSidebar.ts"
  - "src/Plugin/Components/ChatRowMenuHelper.ts"
---

# Chats Panel (`ChatsView` + `ChatsSidebar`)

Two implementations of the same chats list:

1. **`src/Plugin/ChatsView/ChatsView.ts`** — standalone `ItemView` (view type `CHATS_VIEW_TYPE = "llm-chats-view"`); `open-chats-panel` command / `plugin.activateChatsPanel()` opens it in the right sidebar.
2. **`src/Plugin/Components/ChatsSidebar.ts`** — `Component` rendering the same list into any container; used by `WidgetView` as a toggleable left panel (toggled by the `messages-square` button in `Header.ts`, widget only). Widget body order: `llm-widget-chats-sidebar` → `llm-widget-main` → `llm-widget-details-sidebar`.

Shared behavior: `plugin.chatHistory.list()` on open, auto-refresh via vault events, title/timestamp/project/agent badges per row, inline search, row click opens the chat in the widget, "new chat" button calls `plugin.activateTab()`. Uses native nav/tree-item/`.tag`/`pane-empty` DOM patterns; CSS prefix `.llm-chats-*`.

## Chat-row three-dot context menu — shared helper

`src/Plugin/Components/ChatRowMenuHelper.ts` exports `attachChatRowMenu(itemSelf, flairOuter, file, plugin, onRefresh)` and `RenameModal`, used by both `ChatsView` and `ChatsSidebar`. Call it once per row right after creating `flairOuter`; it appends a hover-revealed `.llm-chats-row-menu-btn`.

"Open in" dispatch methods on `LLMPlugin`: `openChatFileInWidget(path)`, `openChatFileInSidebar(path)`, `openChatFileInFAB(path)` (→ `fab.openAtHistoryFile`), `openChatFileInPopover(path)` (→ `statusBarButton.openAtHistoryFile`). `FAB.openAtHistoryFile()` relies on private DOM refs assigned in `generateFAB()` and cleared in `removeFab()`.
