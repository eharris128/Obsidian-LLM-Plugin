# Spec: Fix Context Window Budget Calculation

## Problem

The "Context token budget (%)" setting is broken by design. The budget is
calculated as:

```
context budget = maxTokens * contextPercent / 100
```

`maxTokens` is the **response length** setting (currently defaulting to 300),
not the model's context window. So with default settings, only 210 tokens are
budgeted for context — regardless of whether the model supports 200,000. The
two concepts need to be separated.

## Goal

Use each model's actual context window size as the basis for context budget
calculation, while keeping `maxTokens` as a response-length-only control.

---

## Changes Required

### 1. `src/Types/types.ts` — Add `contextWindow` to `Model`

```typescript
export type Model = {
    model: string;
    type: string;
    endpoint: string;
    url: string;
    contextWindow?: number; // model's input context limit in tokens
};
```

### 2. `src/utils/models.ts` — Populate `contextWindow` for all known models

Add `contextWindow` to every entry in the `models` record. Use the values
below. For `buildOllamaModels`, add an optional `contextWindows` parameter
(a `Record<string, number>` mapping model name → num_ctx from Ollama's API).

**Cloud model context windows:**

| Model | contextWindow |
|---|---|
| ChatGPT-3.5 turbo | 16_385 |
| GPT-4o | 128_000 |
| GPT-4o-mini | 128_000 |
| GPT-4.1 | 1_047_576 |
| GPT-4.1-mini | 1_047_576 |
| GPT-4.1-nano | 1_047_576 |
| o3 | 200_000 |
| o3-mini | 200_000 |
| o4-mini | 200_000 |
| Claude Sonnet 4.6 | 200_000 |
| Claude Opus 4.6 | 200_000 |
| Claude Haiku 4.5 | 200_000 |
| Gemini-3-Pro-Preview | 1_048_576 |
| Gemini-2.5-Pro | 1_048_576 |
| Gemini-2.5-Flash | 1_048_576 |
| Gemini-2.5-Flash-Lite | 1_048_576 |
| Gemini-2.0-Flash | 1_048_576 |
| Gemini-2.0-Flash-Lite | 1_048_576 |
| Gemini-Flash-Latest | 1_048_576 |
| Gemini-Flash-Lite-Latest | 1_048_576 |
| Mistral Large | 131_072 |
| Mistral Medium | 131_072 |
| Mistral Small | 131_072 |
| Mistral Nemo | 131_072 |
| Magistral Medium | 131_072 |
| Magistral Small | 131_072 |
| Devstral Small | 131_072 |
| Codestral | 131_072 |
| GPT4All models | 8_192 (fallback) |
| Claude Code | 200_000 |

Update `buildOllamaModels` signature:

```typescript
export function buildOllamaModels(
    ollamaModelNames: string[],
    contextWindows: Record<string, number> = {}
): { models: Record<string, Model>, names: Record<string, string> } {
    // For each name, set contextWindow: contextWindows[name] ?? 8_192
}
```

### 3. `src/utils/utils.ts` — Add `fetchOllamaContextWindows`

Add a new exported function alongside `fetchOllamaModels`. It calls Ollama's
`/api/show` endpoint for each discovered model name and extracts `num_ctx`
from the response.

```typescript
export async function fetchOllamaContextWindows(
    host: string,
    modelNames: string[]
): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const name of modelNames) {
        try {
            const response = await requestUrl({
                url: `${host}/api/show`,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name }),
            }).then((res) => res.json);
            // num_ctx lives at model_info["llm.context_length"] or
            // parameters.num_ctx depending on Ollama version — check both
            const fromInfo = response?.model_info?.["llm.context_length"];
            const fromParams = response?.parameters
                ? parseInt(
                      (response.parameters as string)
                          .split("\n")
                          .find((l: string) => l.startsWith("num_ctx"))
                          ?.split(/\s+/)[1] ?? ""
                  )
                : NaN;
            const ctx = fromInfo ?? (isNaN(fromParams) ? undefined : fromParams);
            if (ctx && ctx > 0) result[name] = ctx;
        } catch {
            // silently skip — 8_192 fallback applies in buildOllamaModels
        }
    }
    return result;
}
```

### 4. `src/Settings/SettingsView.ts` — Call `fetchOllamaContextWindows` on refresh

In the Ollama "Refresh" button `onClick` handler (around line 229), after
`fetchOllamaModels` returns `foundModels`, call `fetchOllamaContextWindows`
and pass the result into `buildOllamaModels`. Also persist the context windows
map to settings so it survives reload (see §5).

```typescript
const foundModels = await fetchOllamaModels(this.plugin.settings.ollamaHost);
const ctxWindows = await fetchOllamaContextWindows(
    this.plugin.settings.ollamaHost,
    foundModels
);
this.plugin.settings.ollamaModels = foundModels;
this.plugin.settings.ollamaContextWindows = ctxWindows;
const built = buildOllamaModels(foundModels, ctxWindows);
// ... rest of existing handler unchanged
```

### 5. `src/main.ts` — Persist and restore Ollama context windows

Add `ollamaContextWindows: Record<string, number>` to the `LLMPluginSettings`
type and its default value (`{}`).

Update `registerOllamaModels()` to pass the stored context windows:

```typescript
private registerOllamaModels() {
    if (this.settings.ollamaModels.length > 0) {
        const built = buildOllamaModels(
            this.settings.ollamaModels,
            this.settings.ollamaContextWindows ?? {}
        );
        Object.assign(models, built.models);
        Object.assign(modelNames, built.names);
    }
}
```

### 6. `src/Plugin/Components/ChatContainer.ts` — Use `contextWindow`, not `maxTokens`

Around line 619, replace the `maxTokens` fallback with a lookup of the
selected model's `contextWindow`:

```typescript
// Before:
const maxTokens = this.plugin.settings[settingType].chatSettings.maxTokens || 16384;

// After:
const selectedModelKey = this.plugin.settings[settingType].modelName;
const selectedModel = models[selectedModelKey];
const contextWindowSize = selectedModel?.contextWindow ?? 8_192;
```

Then pass `contextWindowSize` (not `maxTokens`) into `calculateContextTokenBudget`:

```typescript
const contextTokenBudget = this.contextBuilder.calculateContextTokenBudget(
    contextWindowSize,   // ← was maxTokens
    contextSettings.maxContextTokensPercent
);
```

`ContextBuilder.calculateContextTokenBudget` itself does not need to change.

---

## What Does NOT Change

- The "Tokens" setting continues to control max response length — it is passed
  as `max_tokens` / `tokens` in API payloads unchanged.
- The "Context token budget (%)" setting UI is unchanged — it now correctly
  means "% of the model's context window to reserve for injected context."
- `ContextBuilder.calculateContextTokenBudget` is unchanged.
- No new UI is needed. The fix is entirely in the data layer and one call-site.

---

## Testing

1. Set Context token budget to 70%. With Claude Sonnet 4.6 selected, verify
   via a log or debugger that `contextTokenBudget` is ~140,000, not 210.
2. With an Ollama model selected, click "Refresh" in settings, then verify
   `plugin.settings.ollamaContextWindows` contains a non-zero entry for each
   model. Verify `contextWindowSize` uses that value in `ChatContainer`.
3. Confirm the "Tokens" (max response) setting still has no effect on context
   window size.
