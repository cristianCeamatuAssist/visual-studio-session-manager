# Claude Pulse

Monitor Claude Code sessions across VS Code windows with live status indicators.

## Features

- **Auto-discover open windows** — automatically detects all open VS Code windows via a shared workspace registry, no manual setup needed
- **Live session status** — see which projects have active or waiting Claude Code sessions at a glance
- **Sidebar panel** — dedicated activity bar icon with a tree view of all your open projects
- **Focused window indicator** — the current window's project shows a white border ring around its status dot for quick identification
- **Smart window switching** — click to switch projects; on macOS the new window appears in the exact same position
- **Drag-and-drop reordering** — drag projects in the sidebar to arrange them in your preferred order
- **Status bar** — shows total Claude session count with color-coded status
- **Terminal integration** — open a terminal at any project directory with one click
- **Hook integration** — CLI hooks for instant status updates across all VS Code windows

## Getting Started

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cristianCeamatuAssist.vscode-session-manager)
2. Open the **Claude Pulse** panel in the activity bar (left sidebar)
3. Your open VS Code windows appear automatically
4. Run **Claude Pulse: Install Status Hooks** from the command palette for instant status updates

## How It Works

The extension maintains a shared workspace registry at `~/.claude/vscode-workspaces/` — each open VS Code window registers itself so all instances stay in sync. Session status is detected via CLI hooks that write marker files when Claude starts working or finishes a response.

| Status | Dot color | Meaning |
|--------|-----------|---------|
| Working | Orange | Claude is actively processing |
| Needs input | Green | Claude finished — your turn |
| No session | Gray | No active Claude session |

The current window's project gets a **white border ring** around its status dot so you can quickly spot it in the list.

Window switching on macOS uses AppleScript to capture the current window position before opening a new project, then repositions the new window to the same coordinates.

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeSessions.pollingInterval` | `3000` | How often to check session status (ms) |
| `claudeSessions.showStatusBar` | `true` | Show session count in status bar |

## Requirements

- macOS (window positioning and process detection use AppleScript and `ps`)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and used at least once
- VS Code 1.74 or later

## License

MIT
