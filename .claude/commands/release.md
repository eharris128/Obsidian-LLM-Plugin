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

6. **Push** to main:
   ```
   git push origin main
   ```

7. **Create the GitHub release** with `gh release create`. Upload 3 assets: `main.js`, `manifest.json`, `styles.css`. This also creates the git tag automatically. Use the tag format `X.Y.Z` (no `v` prefix) to match previous releases. Include a changelog in the release notes.

8. Share the release URL with the user.
