# Spec: Smart Response Length

## Problem

`chatSettings.maxTokens` is a flat user-set number (default 300) that caps
response length. This is wrong for two reasons:

1. **Cloud models** don't need a cap at all — they stop naturally when done.
   Forcing 300 tokens truncates most meaningful answers.
2. **Local models** (Ollama, GPT4All) need a cap, but the right value is
   dynamic: whatever space remains in the context window after context
   injection. A fixed number risks the model running past its window or
   needlessly cutting off responses.

## Goal

- Cloud models: send no `max_tokens` cap by default (let the model decide),
  with `model.maxOutputTokens` as a safety ceiling.
- Local models: compute the response cap dynamically as
  `contextWindow - contextTokenBudget`, floored at 1024.
- The user's "Tokens" setting becomes an **optional manual override** — when
  set to 0, the smart default applies. When set to a positive number, that
  value is used as a hard cap (cannot exceed `model.maxOutputTokens`).
- Update the "Tokens" setting description and default to reflect this.

---

## Changes Required

### 1. `src/Types/types.ts` — Add `maxOutputTokens` to `Model`

```typescript
export type Model = {
    model: string;
    type: string;
    endpoint: string;
    url: string;
    contextWindow?: number;
    maxOutputTokens?: number; // model's max response length; undefined = no cap
};
```

### 2. `src/utils/models.ts` — Populate `maxOutputTokens` for all known models

Add `maxOutputTokens` alongside `contextWindow` on every model entry.

| Model | maxOutputTokens |
|---|---|
| ChatGPT-3.5 turbo | 4_096 |
| GPT-4o | 16_384 |
| GPT-4o-mini | 16_384 |
| GPT-4.1 | 32_768 |
| GPT-4.1-mini | 32_768 |
| GPT-4.1-nano | 32_768 |
| o3 | 100_000 |
| o3-mini | 65_536 |
| o4-mini | 100_000 |
| Claude Sonnet 4.6 | 64_000 |
| Claude Opus 4.6 | 32_000 |
| Claude Haiku 4.5 | 16_000 |
| All Gemini models | 65_536 |
| All Mistral/Magistral models | 32_768 |
| Claude Code | 64_000 |
| GPT4All models | leave undefined (dynamic) |
| Ollama models | leave undefined (dynamic) |

Also update `buildOllamaModels` — Ollama models should have no
`maxOutputTokens` set (undefined), so the dynamic calculation kicks in.

### 3. `src/main.ts` — Change default `maxTokens` to 0

In `DEFAULT_SETTINGS`, set `maxTokens: 0` for all view settings. 0 is the
sentinel value meaning "use smart default."

Also update the `LLMPluginSettings` type if `maxTokens` has a non-zero
hardcoded default anywhere.

### 4. `src/Plugin/Components/SettingsContainer.ts` — Update "Tokens" setting UI

Around line 343, update the setting description to reflect that 0 means
automatic:

```typescript
.setName("Max response tokens")
.setDesc(
    "Maximum tokens in the response. Set to 0 (recommended) to let the " +
    "model decide — cloud models stop naturally, local models use the " +
    "remaining context window. Set a positive number to enforce a hard cap."
)
```

The input field itself does not need to change.

### 5. `src/services/ContextBuilder.ts` — Add `estimateTokens` helper

Add a static helper the rest of the code can use for rough token counts.
The existing `truncateToTokenLimit` already uses the `chars / 4` heuristic —
just expose it:

```typescript
static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}
```

### 6. `src/Plugin/Components/ChatContainer.ts` — Compute effective max tokens

This is the core change. Replace the fixed `maxTokens` lookup (line 619)
with a `resolveEffectiveMaxTokens()` helper and call it before the API call.

Add a private method to `ChatContainer`:

```typescript
private resolveEffectiveMaxTokens(
    contextTokenBudget: number
): number {
    const settingType = getSettingType(this.viewType);
    const userMax = this.plugin.settings[settingType].chatSettings.maxTokens;
    const selectedModelKey = this.plugin.settings[settingType].modelName;
    const selectedModel = models[selectedModelKey];
    const modelType = this.plugin.settings[settingType].modelType;

    const isLocal = modelType === "ollama" || modelType === "GPT4All";

    if (isLocal) {
        // For local models: remaining context window space, floored at 1024
        const contextWindow = selectedModel?.contextWindow ?? 8_192;
        const remaining = contextWindow - contextTokenBudget;
        const dynamicMax = Math.max(remaining, 1024);
        // User override: respect it only if it's positive and smaller
        return userMax > 0 ? Math.min(userMax, dynamicMax) : dynamicMax;
    }

    // Cloud models: no cap by default (send 0 / omit), use maxOutputTokens as ceiling
    const modelCeiling = selectedModel?.maxOutputTokens;
    if (userMax > 0) {
        return modelCeiling ? Math.min(userMax, modelCeiling) : userMax;
    }
    // 0 = let the model decide; return 0 and the API call omits the field
    return 0;
}
```

Then in `handleGenerateClick` (around line 619), replace:

```typescript
// Before:
const maxTokens = this.plugin.settings[settingType].chatSettings.maxTokens || 16384;
const contextTokenBudget = this.contextBuilder.calculateContextTokenBudget(
    maxTokens,
    contextSettings.maxContextTokensPercent
);
```

With (note: context window fix from previous spec must already be in place):

```typescript
const selectedModelKey = this.plugin.settings[settingType].modelName;
const selectedModel = models[selectedModelKey];
const contextWindowSize = selectedModel?.contextWindow ?? 8_192;

const contextTokenBudget = this.contextBuilder.calculateContextTokenBudget(
    contextWindowSize,
    contextSettings.maxContextTokensPercent
);

const effectiveMaxTokens = this.resolveEffectiveMaxTokens(contextTokenBudget);
```

### 7. `src/Plugin/Components/ChatContainer.ts` — Pass `effectiveMaxTokens` to API calls

Wherever `params` is built via `getParams()`, the `tokens` field comes from
`chatSettings.maxTokens`. After computing `effectiveMaxTokens` above, override
it on the params object before the API call:

```typescript
const params = this.getParams(modelEndpoint, model, modelType);
// Override tokens with the smart-computed value
if ("tokens" in params) {
    (params as ChatParams).tokens = effectiveMaxTokens || undefined;
    // undefined causes the field to be omitted from the API payload (no cap)
}
```

In the API call layer (`utils/utils.ts` and provider-specific functions),
ensure that when `tokens` is `undefined` or `0`, the `max_tokens` field is
omitted from the request body rather than sent as 0. Most providers treat
a missing field as "no limit" and `0` as invalid. Check each provider's
send logic and add a guard:

```typescript
// Only include max_tokens if tokens is a positive number
if (params.tokens && params.tokens > 0) {
    payload.max_tokens = params.tokens;
}
```

---

## What Does NOT Change

- The "Tokens" setting remains in the UI — it is now an optional override
  rather than a required value.
- `calculateContextTokenBudget` is unchanged.
- The context budget percentage logic is unchanged.
- This spec depends on the context window fix (`context-window-fix.md`) being
  implemented first. `contextWindowSize` must come from `model.contextWindow`,
  not `maxTokens`.

---

## Testing

1. Select a Claude model, set Tokens to 0. Send a long-form request ("write
   me a detailed explanation of X"). Verify the response is not cut off at
   300 tokens.
2. Select an Ollama model with an 8k context window and 70% context budget.
   Log `effectiveMaxTokens` — should be approximately
   `8192 - (8192 * 0.70) = 2457`, not 300.
3. Set Tokens to 500 with a Claude model selected. Verify the response stops
   at 500 tokens (manual override respected).
4. Set Tokens to 500 with an Ollama model on a small context window where the
   dynamic cap would be 300. Verify the response caps at 300 (dynamic wins
   because it's lower).
5. Verify no API errors — specifically that `max_tokens: 0` is never sent to
   any provider.
