# Visual Studio Session Manager

## Publishing

CI/CD publishes automatically via GitHub Actions on **tag push** (not on branch push).

To release a new version:
1. Bump `version` in `package.json`
2. Update the `hookSuggestionShown_vX.Y.Z` key in `src/extension.ts` if hooks changed
3. Commit and push to `main`
4. Create and push a tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
5. The `Publish Extension` workflow runs: install, test, then `npx @vscode/vsce publish`

The workflow requires the `VSCE_PAT` secret in GitHub repo settings.

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
