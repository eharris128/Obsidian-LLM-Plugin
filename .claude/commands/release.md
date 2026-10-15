# Release

Create a new release for the Obsidian LLM Plugin.

## Steps

1. **Ensure you are on `main`** and it is up to date:
   ```
   git checkout main && git pull origin main
   ```

2. **Ask the user** what version bump to use (patch, minor, or pre-release). Current version can be found in `package.json`.

3. **Bump the version** using `npm version <patch|minor|...> --no-git-tag-version`. This updates:
   - `package.json`
   - `package-lock.json`
   - `manifest.json` (via `version-bump.mjs`)
   - `versions.json` (via `version-bump.mjs`)

4. **Build** the production bundle:
   ```
   npm run build
   ```

5. **Commit** the version bump files:
   ```
   git add package.json package-lock.json manifest.json versions.json
   git commit -m "release: <version>"
   ```

**Canonical repo:** Obsidian's community plugin browser reads `manifest.json` from the default branch of **`eharris128/Obsidian-LLM-Plugin`** (see `community-plugins.json`). In this checkout `origin` is the `jsmorabito` fork — pushing only to `origin` leaves the published manifest on the old version and the release is never offered as an update. Always push and release against `eharris128` explicitly.

6. **Push** to both the fork and the canonical repo:
   ```
   git push origin main
   git push https://github.com/eharris128/Obsidian-LLM-Plugin.git main
   ```

7. **Create the GitHub release** on the canonical repo with `gh release create`, passing `-R` and `--target main` so the tag points at the `release: X.Y.Z` commit (not an older one). Upload 3 assets — **IMPORTANT: esbuild outputs to `../large-language-models/main.js`, NOT `./main.js`**. Always use the path `../large-language-models/main.js` for the `main.js` asset. `manifest.json` and `styles.css` are in the repo root as usual. Use the tag format `X.Y.Z` (no `v` prefix) to match previous releases. Include a changelog in the release notes.
   ```
   gh release create X.Y.Z "../large-language-models/main.js" manifest.json styles.css -R eharris128/Obsidian-LLM-Plugin --target main --title "X.Y.Z" --notes "..."
   ```

8. **Verify** all three report the new version — the canonical `main` manifest, the tagged manifest, and the uploaded asset:
   ```
   R=eharris128/Obsidian-LLM-Plugin
   gh api repos/$R/contents/manifest.json --jq .content | base64 -d | grep '"version"'
   gh api "repos/$R/contents/manifest.json?ref=X.Y.Z" --jq .content | base64 -d | grep '"version"'
   gh release download X.Y.Z -R $R -p manifest.json -O - | grep '"version"'
   ```
   If any is stale, fix it before reporting the release as done.

9. Share the release URL with the user.
