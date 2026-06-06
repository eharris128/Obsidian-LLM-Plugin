# E2E Test Suite

End-to-end tests that drive a **real, sandboxed Obsidian instance** via
[wdio-obsidian-service](https://github.com/jesse-r-s-hines/wdio-obsidian-service).
Nothing here touches your real vault, config, or `data.json`.

```bash
npm run test:e2e
```

The first run downloads Obsidian (~150 MB) into `.obsidian-cache/` (gitignored);
subsequent runs reuse the cache. Pin versions with env vars:

```bash
OBSIDIAN_APP_VERSION=earliest OBSIDIAN_INSTALLER_VERSION=earliest npm run test:e2e
```

(`earliest` resolves to `minAppVersion` from `manifest.json`.)

## Layout

| Path | Purpose |
|------|---------|
| `wdio.conf.mts` (repo root) | WebdriverIO config — one sandboxed Obsidian per spec file, up to 4 in parallel |
| `scripts/stage-plugin.mjs` | Copies `manifest.json` + `main.js` + `styles.css` into `test/plugin-dist/` with a deterministic test `data.json` |
| `test/plugin-dist/` | Staged plugin installed into test vaults (gitignored) |
| `test/vaults/simple/` | Default test vault, copied fresh per run |
| `test/specs/*.e2e.ts` | Mocha specs (own `test/tsconfig.json`, type-checked by `test:e2e`) |
| `test/logs/` | wdio logs (gitignored) |

## Conventions

- **Never pass `plugins: ["."]` in `wdio.conf.mts`.** The service copies
  `data.json` from the plugin dir into test vaults — pointing at the repo root
  would leak the developer's real API keys/settings into the sandbox and make
  runs non-deterministic. Always go through `test/plugin-dist/`.
- **Never hardcode the plugin id.** Read it via `PLUGIN_ID` from
  `test/specs/helpers.ts` (the dev worktree may carry a local-only manifest id).
- **Specs must not require API keys or network providers.** The staged test
  `data.json` enables `rootVaultFolder: "AI"` (which seeds built-in skills) and
  nothing else. Provider round-trip tests, if added later, must skip gracefully
  when the provider is unavailable.
- The slash menu element always exists on `document.body` with `display: none`
  — assert `toBeDisplayed()`, never `toExist()`.
- Each spec file gets its own Obsidian instance, but tests within a file share
  state — clean up leaves in `beforeEach`/`after` hooks.
