# VS Code Marketplace Publishing Setup

**Date:** 2026-03-27
**Status:** Approved

## Goal

Publish the Visual Studio Session Manager extension to the VS Code Marketplace with automated CI/CD via GitHub Actions.

## Publisher

- **Publisher ID:** `cristianCeamatuAssist`
- **Extension ID:** `cristianCeamatuAssist.vscode-session-manager`
- **Marketplace URL:** `marketplace.visualstudio.com/items?itemName=cristianCeamatuAssist.vscode-session-manager`

## Architecture

### Release Flow

```
Push to main → git tag vX.Y.Z → git push --tags → GitHub Action triggers → tests → publish
```

### GitHub Actions Workflow (`.github/workflows/publish.yml`)

- **Trigger:** Push of tags matching `v*`
- **Steps:** checkout → setup node 20 → npm install → npm test → vsce publish
- **Secret:** `VSCE_PAT` (Azure DevOps Personal Access Token with Marketplace > Manage scope)

### Changes Made

1. `package.json` — added `publisher: "cristianCeamatuAssist"`
2. `.github/workflows/publish.yml` — automated publish on tag push
3. `README.md` — updated for marketplace (install link, features, configuration)
4. `.vscodeignore` — added `.github/**`, `docs/**`, `*.vsix` to keep package clean

### Manual Steps (User)

1. Create publisher at marketplace.visualstudio.com/manage — **Done**
2. Create PAT at Azure DevOps with Marketplace > Manage scope
3. Add PAT as `VSCE_PAT` secret in GitHub repo settings
4. Make repo public (or keep private with `--allow-missing-repository` flag in workflow)
