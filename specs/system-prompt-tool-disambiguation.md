# Spec: System Prompt Tool Disambiguation + Learning Loop

## Background

The Obsidian Agent's `buildSystemPrompt()` method constructs the system prompt that governs agent behavior. Two issues have been identified:

1. **Tool confusion bug**: Small models (e.g. 9B parameter local models) conflate `grep_vault`/`search_vault_semantic` (local vault search) with `web_search` (internet search). When asked to follow up on a web search result, they call `grep_vault` instead. The root cause is that the system prompt doesn't explicitly distinguish the two categories of tools or provide negative examples.

2. **No learning loop**: Users have no way to teach the agent their preferences without editing plugin source. The plugin already supports an `agentGuidanceFile` vault note that is appended to the system prompt each turn — this is the right mechanism, but the agent isn't instructed to use it for self-updating.

---

## Changes Required

All changes are in `buildSystemPrompt()`. The method lives in the source file that compiles into the agent section of `main.js` (search for `buildSystemPrompt` to locate it).

### 1. Add tool category boundary to the Vault Search Strategy section

**Current text** (the section pushed into `parts` as "Vault Search Strategy"):

```
For any vault search, run BOTH tools and combine unique files before responding:

1. **`grep_vault`** — exact/near-exact matches. ...
2. **`search_vault_semantic`** — conceptual/thematic matches. ...

Never rely on only one tool — grep misses paraphrases, semantic search misses exact terms.
```

**Change**: Add a clarifying rule at the end of this section, after "Never rely on only one tool...":

```
`grep_vault` and `search_vault_semantic` search **local vault notes only** — they have no access to the internet. Never use them to follow up on a web search result or fetch online information. For anything internet-facing, use `web_search`.
```

### 2. Add a learning loop instruction

The plugin already reads `settings.agentGuidanceFile` and appends it to the system prompt as `## Vault Guidance`. Add a new `parts.push(...)` block **before** the guidance file section (so the instruction appears before the guidance content). The new section should read:

```
## Learning Loop

If the user expresses a persistent behavioral preference — using phrases like "remember that", "always", "never", "from now on", or "I prefer" — update the agent guidance file at `<agentGuidancePath>` to record the new preference, then confirm the update. If no guidance file is configured, tell the user to set one in plugin settings.

Do not update the guidance file for one-off requests or task-specific instructions. Only write preferences that should apply to all future conversations.
```

Where `<agentGuidancePath>` is the runtime value of `settings.agentGuidanceFile` (interpolate it into the string the same way `chatFolder` is used elsewhere in this method). If no guidance file is configured, use the fallback text `"the agent guidance file (not yet configured — ask the user to set one in plugin settings)"`.

---

## Acceptance Criteria

- When a user asks the agent to "go deeper" or "find more" after a `web_search` turn, the agent calls `web_search` again, not `grep_vault`.
- When a user says "remember that you should always use bullet points", the agent appends that preference to the configured guidance file and confirms.
- When no guidance file is configured and the user tries to teach a preference, the agent informs the user they need to configure one in settings.
- No behavior change for normal vault searches or web searches initiated from scratch.

---

## Notes

- Do not change the `agentGuidanceFile` read logic — only add the learning loop instruction before it.
- The guidance file path is already available as `settings.agentGuidanceFile` within `buildSystemPrompt()`.
- This is a prompt-only change; no new tools, settings, or UI are required.
