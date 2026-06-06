---
paths:
  - "src/Settings/**"
---

# Feature Gates (`featureSettings`)

Advanced settings tabs are hidden by default. `LLMPluginSettings.featureSettings` (`FeatureSettings` in `types.ts`) holds a boolean per feature (all default `false`); the "Features" section in General settings is the entry point.

Gated nav items → keys: `obsidian-agent` → `obsidianAgent` (syncs `obsidianAgentSettings.enabled`), `transcription` → `transcription` (syncs `whisperSettings.enabled`), `projects` → `projects`, `assistants` → `assistants`, `memory` → `memory` (syncs `memorySettings.enabled`), `embeddings` → `vaultSearch` (syncs `ragSettings.enabled`).

Toggling calls `LLMSettingsModal.rebuildSidebar()`; disabling the current tab navigates back to General. New gated item: add `featureGate: "keyName"` to its `navSections` entry, add the key to `FeatureSettings`, add a `FeatureDef` in `renderGeneral()`.
