---
paths:
  - "src/services/ChatHistory.ts"
---

# Tool call recording in chat files

`ChatContainer` tracks `pendingToolCalls: ToolCallRecord[]` (current agent turn) and `allToolCallsByTurn: Map<number, ToolCallRecord[]>` (keyed by 0-based assistant-message index, captured as `turnIndex` at `runAgentMode` start; committed after the turn). Both reset in `newChat()`. `ChatHistory.save()` takes an optional `toolCallsByTurn`; `messagesToMarkdown` writes a `> [!tool-use]-` callout after each `## Assistant` heading, and `markdownToMessages` strips these so they never pollute re-submitted context.

Skill callouts follow the same pattern: `ChatHistory.save()` takes optional `skillsByTurn` (7th arg); saved files get a `> [!tip]- Skill: <id>` callout after `## Assistant` (stripped on load); `load()` returns it on `LoadedChat`.
