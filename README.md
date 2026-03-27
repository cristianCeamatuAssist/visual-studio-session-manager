# Visual Studio Session Manager

Monitor and switch between VS Code projects with live Claude Code CLI session status indicators.

## Features

- **Live session status** — see which projects have active, waiting, or inactive Claude Code sessions at a glance
- **Sidebar panel** — dedicated activity bar icon with a tree view of all your monitored projects
- **Auto-detect projects** — scans your Claude Code session history and adds projects automatically
- **Smart window switching** — click to switch projects; on macOS the new window appears in the exact same position
- **Expandable sessions** — expand a project to see individual sessions with PID, CPU usage, and start time
- **Status bar** — shows total Claude session count with color-coded status
- **Terminal integration** — open a terminal at any project directory with one click
- **Hook integration** — optional CLI hooks for instant status updates across all VS Code windows

## Getting Started

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cristianCeamatuAssist.vscode-session-manager)
2. Open the **Claude Sessions** panel in the activity bar (left sidebar)
3. Click **Auto-Detect from Claude History** to find your projects, or add them manually
4. Optionally run **Claude Sessions: Install Status Hooks** from the command palette for instant status updates

## How It Works

The extension reads session files from `~/.claude/sessions/` to discover Claude Code CLI sessions, then uses `ps` to check process status and CPU usage. Sessions are matched to projects by comparing working directories.

| Status | Meaning |
|--------|---------|
| Green dot | Claude is actively working (high CPU) |
| Yellow dot | Claude is waiting for input |
| Gray dot | No active session |

Window switching on macOS uses AppleScript to capture the current window position before opening a new project, then repositions the new window to the same coordinates.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeSessions.pollingInterval` | `3000` | How often to check session status (ms) |
| `claudeSessions.cpuThreshold` | `5` | CPU% threshold for active vs waiting |
| `claudeSessions.showStatusBar` | `true` | Show session count in status bar |

## Requirements

- macOS (window positioning and process detection use AppleScript and `ps`)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and used at least once
- VS Code 1.74 or later

## License

MIT
