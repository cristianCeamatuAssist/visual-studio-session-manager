# Visual Studio Session Manager

Monitor and switch between VS Code projects with Claude Code CLI session status indicators.

## Features

- **Project Sidebar** — See all your projects in a dedicated activity bar panel with live session status (active/waiting/inactive)
- **Session Monitoring** — Detects running Claude Code CLI sessions by reading `~/.claude/sessions/` and checking process status
- **Smart Window Switching** — Click a project to switch to it. On macOS, the new window appears in the exact same position for seamless switching
- **Auto-Detect Projects** — Automatically discovers projects from your Claude Code session history
- **Expandable Sessions** — Expand a project to see individual sessions with PID, CPU usage, and start time
- **Status Bar** — Shows total Claude session count with color-coded status
- **Terminal Integration** — Open a terminal at any project directory with one click

## Requirements

- macOS (window positioning uses AppleScript)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and used at least once
- VS Code 1.74 or later

## Installation

1. Download the latest `.vsix` file from [Releases](https://github.com/cristianCeamatuAssist/visual-studio-session-manager/releases)
2. Install it:

```bash
code --install-extension vscode-session-manager-0.1.0.vsix
```

Or in VS Code: `Cmd+Shift+P` → "Extensions: Install from VSIX..." → select the downloaded file.

## Usage

1. Open the **Session Manager** panel in the activity bar (terminal icon on the left sidebar)
2. Click **Auto-Detect** (magnifying glass icon) to discover projects from your Claude history
3. Or click **+** to manually add project folders
4. Projects show live status:
   - 🟢 **Active** — Claude is actively working (high CPU)
   - 🟡 **Waiting** — Claude session is idle, waiting for input
   - ⚫ **Inactive** — No running sessions
5. Click a project to switch to it. Right-click for more options (rename, remove, open terminal, open in new window)

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeSessions.pollingInterval` | `3000` | How often to check session status (ms) |
| `claudeSessions.cpuThreshold` | `5.0` | CPU% above which a session is "active" vs "waiting" |
| `claudeSessions.showStatusBar` | `true` | Show session count in the status bar |

## How It Works

The extension reads JSON session files from `~/.claude/sessions/` to discover running Claude Code CLI sessions. It then uses `ps` to check if each session's process is still alive and how much CPU it's consuming. Sessions are matched to projects by comparing the session's working directory (`cwd`) against your registered project paths.

Window switching on macOS uses AppleScript to capture the current window position before opening a new project, then repositions the new window to the same coordinates — giving the impression that you never left.

## License

MIT
