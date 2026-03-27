# Production Readiness: Visual Studio Session Manager

**Date:** 2026-03-27
**Status:** Approved
**Target:** GitHub Release (no marketplace)
**Audience:** Colleagues using Claude Code CLI on macOS

## Context

The extension monitors Claude Code CLI sessions per project and enables quick switching between VS Code windows. It works but lacks documentation, tests, licensing, and version control — all needed before sharing with colleagues.

## Decisions

### Branding

- **Display name:** Visual Studio Session Manager
- **Extension ID (package.json name):** `vscode-session-manager`
- **Internal command/config prefix:** stays `claudeSessions` (no breaking change for existing users)
- **Description:** "Monitor and switch between VS Code projects with Claude Code CLI session status indicators"

### Distribution

- GitHub repo: `cristianCeamatuAssist/visual-studio-session-manager`
- Distribution via GitHub Releases with `.vsix` artifact
- Install: `code --install-extension vscode-session-manager-0.1.0.vsix`
- No VS Code Marketplace publishing

### package.json Changes

- `name`: `vscode-session-manager`
- `displayName`: `Visual Studio Session Manager`
- Add `license`: `MIT`
- Add `repository`: `{ "type": "git", "url": "https://github.com/cristianCeamatuAssist/visual-studio-session-manager" }`
- Add `homepage`: GitHub repo URL
- Add `bugs`: `{ "url": "https://github.com/cristianCeamatuAssist/visual-studio-session-manager/issues" }`
- Remove `publisher` field
- Version: `0.1.0`

### New Files

#### README.md
- Extension name and one-line description
- Features list (project management, session monitoring, window switching, status bar)
- Install instructions (download `.vsix` from Releases, run `code --install-extension`)
- Configuration options table (pollingInterval, cpuThreshold, showStatusBar)
- How it works section (reads `~/.claude/sessions/`, monitors processes via `ps`)
- Requirements: macOS, Claude Code CLI, VS Code 1.74+

#### CHANGELOG.md
- v0.1.0 — Initial release with feature list

#### LICENSE
- MIT license, copyright Cristian Ceamatu

### Unit Tests

**Framework:** Vitest (lightweight, fast, no need for VS Code test host for pure logic testing)

**Test files:**
- `src/__tests__/projectManager.test.ts`
  - Add project, prevent duplicates
  - Remove project by path (with trailing slash normalization)
  - Rename project
  - `decodeProjectDirName()` — path decoding from Claude's encoding format
  - `resolveEncodedPath()` — greedy matching for paths with hyphens
  - Auto-detect reads session dirs and project dirs

- `src/__tests__/claudeProcessDetector.test.ts`
  - `readSessionFiles()` — parse valid JSON, skip invalid files
  - `getStatusForProject()` — match sessions to projects by CWD
  - Status determination: Active (CPU > threshold), Waiting (CPU <= threshold), Inactive (no sessions)
  - `batchCheckProcesses()` — parse `ps` output

**Mocking strategy:**
- Mock `fs` (readdir, readFile, existsSync) for session/project file reading
- Mock `child_process` for `ps` command output
- Mock `vscode` workspace configuration API for projectManager

### Git Setup

- `.gitignore`: node_modules/, dist/, *.vsix, .DS_Store
- Initialize git repo
- Initial commit with all source
- Add remote to GitHub repo
- Push to main
- Create GitHub Release v0.1.0 with `.vsix` attached

### Code Cleanup

- Remove any debug artifacts or hardcoded paths
- Audit usage of child_process for safety (inputs are internal, not user-provided)
- No functional changes to extension behavior

### Out of Scope

- CI/CD (GitHub Actions)
- VS Code Marketplace publishing
- Cross-platform support (Windows/Linux)
- Contributing guide
- PNG marketplace icon
- Issue templates

## Implementation Order

1. Rename branding in package.json
2. Add LICENSE, README.md, CHANGELOG.md
3. Set up test infrastructure (vitest config)
4. Write unit tests for projectManager
5. Write unit tests for claudeProcessDetector
6. Git init, .gitignore, initial commit
7. Push to GitHub
8. Build .vsix and create GitHub Release v0.1.0
