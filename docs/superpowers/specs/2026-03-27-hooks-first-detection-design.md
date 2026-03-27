# Hooks-First Session Status Detection

## Problem

The current CPU-based session status detection flickers between "Active" (green) and "Waiting for input" (yellow) because CPU usage naturally fluctuates during Claude Code sessions. Even with debouncing (3 consecutive readings) and child process CPU aggregation, the status indicator is unreliable — users see rapid green→yellow→green cycling when watching a project.

## Solution

Switch to a **hooks-first architecture** where Claude Code CLI hooks are the sole authority for session status when installed. CPU polling remains as a fallback for users without hooks.

## Decision: Approach A — Enhanced Marker Files

We chose the simplest reliable approach: expand the existing marker file system to cover the full session lifecycle. No HTTP servers, no JSON status files — just touch/rm of marker files driven by 4 Claude Code hook events.

### Two Detection Modes

| Mode | When | How Status Is Determined |
|------|------|--------------------------|
| **Hooks mode** | Hooks installed in `~/.claude/settings.json` | Marker files + process liveness only |
| **CPU mode** | Hooks not installed (fallback) | Current CPU polling + debouncing (unchanged) |

### Hook Events

| Event | Script Action | Meaning |
|-------|--------------|---------|
| `UserPromptSubmit` | `rm -f marker` | User sent prompt → Claude starts working |
| `PreToolUse` | `rm -f marker` | Tool about to execute → still working |
| `Stop` | `touch marker` | Claude finished responding → waiting for input |
| `SessionEnd` | `rm -f marker` | Session terminated → clean up |

Marker files: `~/.claude/sessions/.waiting_{sessionId}` (unchanged format).

### Status Logic (Hooks Mode)

```
For each project:
  sessions = alive sessions matching project path
  if no sessions → Inactive (gray)
  if ANY session has a waiting marker → Waiting (yellow)
  else → Active (green)
```

No CPU threshold checks. No debouncing. No child process detection. No `ps` commands.

### Status Logic (CPU Mode — Unchanged)

Current behavior preserved exactly: CPU polling every 3s, debounce 3 consecutive readings, child process aggregation, 5% threshold.

## File Changes

### `hookManager.ts`

- Add `UserPromptSubmit` and `SessionEnd` hook entries to `installHooks()`
- Add corresponding cleanup to `uninstallHooks()`
- Update `isInstalled()` to check for any of the 4 hooks (not just `Stop`)
- Update hook script to handle 4 actions: `stop`, `resume`, `start`, `end`

### `claudeProcessDetector.ts`

- Add `hooksInstalled: boolean` parameter to `detectSessions()` — when true, skip `batchCheckProcesses()` and `getChildProcessCpu()` entirely, set `cpuPercent: -1` on all sessions
- Simplify `getStatusForProject()` hooks path: if hooks installed and sessions exist, check markers only — no CPU fallback logic
- Remove the "markers exist but none match → Active" heuristic (was needed when CPU still ran in parallel)

### `projectTreeProvider.ts`

- Pass `hooksInstalled` flag through to display logic
- When hooks installed: show `"Active"` instead of `"Active - CPU: X%"`
- Session tree items: show `"Active"` instead of `"Active (CPU: X%)"` when in hooks mode

### `statusBarManager.ts`

- When hooks installed: show `"Claude: N active"` without CPU% references
- Active/waiting counts derived from marker files, not CPU threshold

### `extension.ts`

- Cache `hooksInstalled` state at startup and on file watcher events
- Pass cached flag to `detectSessions()` and tree provider
- When hooks installed, increase effective polling interval to 5s (file watcher handles immediacy)

### `constants.ts`

- Add `HOOKS_POLLING_INTERVAL = 5000`
- Add `STALE_MARKER_THRESHOLD = 300000` (5 minutes, for future use)

### `types.ts`

- No structural changes needed. `cpuPercent` stays on `ClaudeSession` but will be `-1` in hooks mode.

## Hook Script

```bash
#!/bin/bash
# Visual Studio Session Manager - Claude CLI hook
ACTION="$1"
SESSIONS_DIR="$HOME/.claude/sessions"
MARKER_PREFIX=".waiting_"

INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)
MARKER_ID="${SESSION_ID:-$PPID}"

if [ -n "$MARKER_ID" ]; then
  case "$ACTION" in
    stop)
      touch "$SESSIONS_DIR/$MARKER_PREFIX$MARKER_ID"
      ;;
    resume|start)
      rm -f "$SESSIONS_DIR/$MARKER_PREFIX$MARKER_ID"
      ;;
    end)
      rm -f "$SESSIONS_DIR/$MARKER_PREFIX$MARKER_ID"
      ;;
  esac
fi
```

## Settings.json Hook Configuration

```json
{
  "hooks": {
    "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.claude/vscode-session-manager-hook.sh stop" }] }],
    "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.claude/vscode-session-manager-hook.sh resume" }] }],
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.claude/vscode-session-manager-hook.sh start" }] }],
    "SessionEnd": [{ "matcher": "", "hooks": [{ "type": "command", "command": "~/.claude/vscode-session-manager-hook.sh end" }] }]
  }
}
```

## Edge Cases

- **Multiple sessions per project**: If ANY session has a waiting marker, project shows as Waiting. If none have markers, Active.
- **Stale markers from crashed sessions**: `cleanStaleMarkers()` already removes markers for dead processes. No change needed.
- **Hook script failure**: If the bash script silently fails, the marker won't be created/removed. The process liveness check still works — worst case, a session shows Active instead of Waiting (safe default).
- **Race condition**: `UserPromptSubmit` fires and removes marker, then `Stop` fires ms later and creates it. This is correct sequential behavior — Claude processed instantly.
- **Existing sessions when hooks installed**: Sessions started before hook installation won't have markers. They'll show as Active (correct safe default — user can observe actual state).

## Testing

- Install hooks → start Claude session → verify Active (no marker)
- Send prompt → verify marker removed (should already not exist)
- Wait for Claude to respond → verify marker created → status shows Waiting
- Send another prompt → verify marker removed → status shows Active
- End session → verify marker cleaned up → status shows Inactive
- Uninstall hooks → verify fallback to CPU mode works
