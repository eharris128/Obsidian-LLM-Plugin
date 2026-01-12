# Prerelease Flow

## Creating a Prerelease

1. Create and push a dev tag based on the current stable version in `manifest.json`:
   ```bash
   git tag v0.19.19-dev
   git push origin v0.19.19-dev
   ```
   (where `0.19.19` is the last stable release in manifest.json)

2. On the GitHub releases page, mark this tag as **Pre-release**

3. In BRAT, select this pre-release version for testing
