# Visual Studio Session Manager

## Publishing

CI/CD publishes automatically via GitHub Actions on **tag push** (not on branch push).
The extension is published to **two registries** from a single packaged `.vsix`:
- **VS Code Marketplace** (for VS Code) — via `@vscode/vsce`
- **Open VSX Registry** (for Cursor, Windsurf, VSCodium, Gitpod) — via `ovsx`

To release a new version:
1. Bump `version` in `package.json`
2. Update the `hookSuggestionShown_vX.Y.Z` key in `src/extension.ts` if hooks changed
3. Commit and push to `main`
4. Create and push a tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
5. The `Publish Extension` workflow runs: install, test, package once, then publish
   the same `.vsix` to both VS Code Marketplace and Open VSX

The workflow requires two secrets in GitHub repo settings:
- `VSCE_PAT` — VS Code Marketplace publish token
- `OVSX_PAT` — Open VSX access token (namespace `cristianCeamatuAssist`)

Notes:
- Open VSX processes uploads asynchronously; an extension may take a few minutes
  after a successful publish before it appears in search / the public page.
- If one registry's publish fails after the other succeeds, re-running the job dies
  on `vsce` ("version already exists") — re-publish the failed registry manually.

To install locally without waiting for marketplace:
```bash
npx @vscode/vsce package
code --install-extension vscode-session-manager-X.Y.Z.vsix --force
```

## Architecture

2-state color system for Claude Code session status:
- **Orange** (terminal.ansiYellow) = working (no marker file)
- **Green** (terminal.ansiGreen) = needs user input (`.waiting_` marker)
- **Gray** = no active sessions

Current window's badge gets a white border ring for quick identification.

Detection uses 5 Claude CLI hooks: Stop, PreToolUse, UserPromptSubmit, Notification (idle_prompt), SessionEnd.
Hook script: `~/.claude/vscode-session-manager-hook.sh`
Markers use PID-based naming (not session_id, which changes on /clear).
Markers stored in: `~/.claude/sessions/`

## Testing

```bash
npx vitest run        # all tests
npm run compile       # build with esbuild
```
