import * as fs from "fs/promises";
import * as path from "path";
import { CLAUDE_SESSIONS_DIR, CLAUDE_SETTINGS_PATH, WAITING_MARKER_PREFIX, DONE_MARKER_PREFIX, DONE_MARKER_TTL } from "./constants";

interface HookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

interface ClaudeSettings {
  hooks?: {
    Stop?: HookEntry[];
    PreToolUse?: HookEntry[];
    [key: string]: HookEntry[] | undefined;
  };
  [key: string]: unknown;
}

const HOOK_SCRIPT_NAME = "vscode-session-manager-hook.sh";
const HOOK_IDENTIFIER = "vscode-session-manager";

function getHookScriptPath(): string {
  return path.join(path.dirname(CLAUDE_SETTINGS_PATH), HOOK_SCRIPT_NAME);
}

function getHookScriptContent(): string {
  return `#!/bin/bash
# Visual Studio Session Manager - Claude CLI hook helper
# Manages marker files for 3-state session status detection:
#   - No marker = working (orange)
#   - .waiting_ marker = needs input (red)
#   - .done_ marker = session completed (green)
ACTION="$1"
SESSIONS_DIR="$HOME/.claude/sessions"
WAITING_PREFIX="${WAITING_MARKER_PREFIX}"
DONE_PREFIX="${DONE_MARKER_PREFIX}"

# Extract session_id from stdin JSON (hook event payload)
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)

# Fallback to PPID if session_id not available
MARKER_ID="\${SESSION_ID:-$PPID}"

if [ -n "$MARKER_ID" ]; then
  case "$ACTION" in
    stop)
      # Claude finished responding — session is now waiting for input
      rm -f "$SESSIONS_DIR/$DONE_PREFIX$MARKER_ID"
      touch "$SESSIONS_DIR/$WAITING_PREFIX$MARKER_ID"
      ;;
    resume|start)
      # Tool about to run OR user submitted prompt — session is active/working
      rm -f "$SESSIONS_DIR/$WAITING_PREFIX$MARKER_ID"
      rm -f "$SESSIONS_DIR/$DONE_PREFIX$MARKER_ID"
      ;;
    end)
      # Session terminated — mark as done (green)
      rm -f "$SESSIONS_DIR/$WAITING_PREFIX$MARKER_ID"
      touch "$SESSIONS_DIR/$DONE_PREFIX$MARKER_ID"
      ;;
  esac
fi
`;
}

export class HookManager {
  async isInstalled(): Promise<boolean> {
    try {
      const content = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
      const settings: ClaudeSettings = JSON.parse(content);
      // All 5 hooks must be present for full 3-state detection
      const hookEvents = ["Stop", "PreToolUse", "UserPromptSubmit", "Notification", "SessionEnd"] as const;
      return hookEvents.every((event) => {
        const eventHooks = settings.hooks?.[event] ?? [];
        return eventHooks.some((h) =>
          h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
        );
      });
    } catch {
      return false;
    }
  }

  async installHooks(): Promise<boolean> {
    try {
      // Step 1: Write the helper script
      const scriptPath = getHookScriptPath();
      await fs.writeFile(scriptPath, getHookScriptContent(), { mode: 0o755 });

      // Step 2: Update Claude settings with hooks
      let settings: ClaudeSettings = {};
      try {
        const content = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
        settings = JSON.parse(content);
      } catch {
        // File doesn't exist or invalid — start fresh
      }

      if (!settings.hooks) {
        settings.hooks = {};
      }

      // Add Stop hook (if not already present)
      const stopHooks = settings.hooks.Stop ?? [];
      const hasStopHook = stopHooks.some((h) =>
        h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
      );
      if (!hasStopHook) {
        stopHooks.push({
          matcher: "",
          hooks: [
            {
              type: "command",
              command: `${scriptPath} stop`,
            },
          ],
        });
        settings.hooks.Stop = stopHooks;
      }

      // Add PreToolUse hook (if not already present)
      const preToolHooks = settings.hooks.PreToolUse ?? [];
      const hasPreToolHook = preToolHooks.some((h) =>
        h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
      );
      if (!hasPreToolHook) {
        preToolHooks.push({
          matcher: "",
          hooks: [
            {
              type: "command",
              command: `${scriptPath} resume`,
            },
          ],
        });
        settings.hooks.PreToolUse = preToolHooks;
      }

      // Add UserPromptSubmit hook (if not already present)
      const userPromptHooks = settings.hooks.UserPromptSubmit ?? [];
      const hasUserPromptHook = userPromptHooks.some((h) =>
        h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
      );
      if (!hasUserPromptHook) {
        userPromptHooks.push({
          matcher: "",
          hooks: [
            {
              type: "command",
              command: `${scriptPath} start`,
            },
          ],
        });
        settings.hooks.UserPromptSubmit = userPromptHooks;
      }

      // Add Notification hook with idle_prompt matcher (if not already present)
      const notificationHooks = settings.hooks.Notification ?? [];
      const hasNotificationHook = notificationHooks.some((h) =>
        h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
      );
      if (!hasNotificationHook) {
        notificationHooks.push({
          matcher: "idle_prompt",
          hooks: [
            {
              type: "command",
              command: `${scriptPath} stop`,
            },
          ],
        });
        settings.hooks.Notification = notificationHooks;
      }

      // Add SessionEnd hook (if not already present)
      const sessionEndHooks = settings.hooks.SessionEnd ?? [];
      const hasSessionEndHook = sessionEndHooks.some((h) =>
        h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
      );
      if (!hasSessionEndHook) {
        sessionEndHooks.push({
          matcher: "",
          hooks: [
            {
              type: "command",
              command: `${scriptPath} end`,
            },
          ],
        });
        settings.hooks.SessionEnd = sessionEndHooks;
      }

      await fs.writeFile(
        CLAUDE_SETTINGS_PATH,
        JSON.stringify(settings, null, 2),
        "utf-8"
      );

      return true;
    } catch {
      return false;
    }
  }

  async uninstallHooks(): Promise<boolean> {
    try {
      const content = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
      const settings: ClaudeSettings = JSON.parse(content);

      if (settings.hooks) {
        // Remove our hooks from Stop
        if (settings.hooks.Stop) {
          settings.hooks.Stop = settings.hooks.Stop.filter(
            (h) => !h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
          );
          if (settings.hooks.Stop.length === 0) {
            delete settings.hooks.Stop;
          }
        }

        // Remove our hooks from PreToolUse
        if (settings.hooks.PreToolUse) {
          settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
            (h) => !h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
          );
          if (settings.hooks.PreToolUse.length === 0) {
            delete settings.hooks.PreToolUse;
          }
        }

        // Remove our hooks from UserPromptSubmit
        if (settings.hooks.UserPromptSubmit) {
          settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
            (h) => !h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
          );
          if (settings.hooks.UserPromptSubmit.length === 0) {
            delete settings.hooks.UserPromptSubmit;
          }
        }

        // Remove our hooks from Notification
        if (settings.hooks.Notification) {
          settings.hooks.Notification = settings.hooks.Notification.filter(
            (h) => !h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
          );
          if (settings.hooks.Notification.length === 0) {
            delete settings.hooks.Notification;
          }
        }

        // Remove our hooks from SessionEnd
        if (settings.hooks.SessionEnd) {
          settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(
            (h) => !h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
          );
          if (settings.hooks.SessionEnd.length === 0) {
            delete settings.hooks.SessionEnd;
          }
        }

        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
      }

      await fs.writeFile(
        CLAUDE_SETTINGS_PATH,
        JSON.stringify(settings, null, 2),
        "utf-8"
      );

      // Remove helper script
      try {
        await fs.unlink(getHookScriptPath());
      } catch {
        // Script already gone
      }

      // Clean up any remaining marker files
      await this.cleanAllMarkers();

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read waiting marker files from the sessions directory.
   * Returns a set of marker IDs (session IDs or PIDs) that are confirmed waiting.
   */
  async getWaitingMarkers(): Promise<Set<string>> {
    const markers = new Set<string>();
    try {
      const files = await fs.readdir(CLAUDE_SESSIONS_DIR);
      for (const file of files) {
        if (file.startsWith(WAITING_MARKER_PREFIX)) {
          const markerId = file.slice(WAITING_MARKER_PREFIX.length);
          if (markerId) {
            markers.add(markerId);
          }
        }
      }
    } catch {
      // Sessions dir doesn't exist
    }
    return markers;
  }

  /**
   * Read done marker files from the sessions directory.
   * Returns a set of marker IDs (session IDs or PIDs) for completed sessions.
   */
  async getDoneMarkers(): Promise<Set<string>> {
    const markers = new Set<string>();
    try {
      const files = await fs.readdir(CLAUDE_SESSIONS_DIR);
      for (const file of files) {
        if (file.startsWith(DONE_MARKER_PREFIX)) {
          const markerId = file.slice(DONE_MARKER_PREFIX.length);
          if (markerId) {
            markers.add(markerId);
          }
        }
      }
    } catch {
      // Sessions dir doesn't exist
    }
    return markers;
  }

  /**
   * Clean up stale marker files for processes/sessions that no longer exist.
   * .waiting_ markers are cleaned immediately; .done_ markers are kept for DONE_MARKER_TTL.
   */
  async cleanStaleMarkers(alivePids: Set<number>, aliveSessionIds: Set<string>): Promise<void> {
    try {
      const files = await fs.readdir(CLAUDE_SESSIONS_DIR);
      const now = Date.now();

      for (const file of files) {
        const filePath = path.join(CLAUDE_SESSIONS_DIR, file);

        if (file.startsWith(WAITING_MARKER_PREFIX)) {
          const markerId = file.slice(WAITING_MARKER_PREFIX.length);
          const markerPid = parseInt(markerId, 10);
          const isPidMarker = !isNaN(markerPid);
          const isStale = isPidMarker
            ? !alivePids.has(markerPid)
            : !aliveSessionIds.has(markerId);

          if (isStale) {
            try { await fs.unlink(filePath); } catch { /* Already removed */ }
          }
        } else if (file.startsWith(DONE_MARKER_PREFIX)) {
          const markerId = file.slice(DONE_MARKER_PREFIX.length);
          const markerPid = parseInt(markerId, 10);
          const isPidMarker = !isNaN(markerPid);
          const isStale = isPidMarker
            ? !alivePids.has(markerPid)
            : !aliveSessionIds.has(markerId);

          // Keep done markers for TTL even if session is gone (green indicator)
          if (isStale) {
            try {
              const stat = await fs.stat(filePath);
              if (now - stat.mtimeMs > DONE_MARKER_TTL) {
                await fs.unlink(filePath);
              }
            } catch { /* Already removed */ }
          }
        }
      }
    } catch {
      // Sessions dir doesn't exist
    }
  }

  private async cleanAllMarkers(): Promise<void> {
    const prefixes = [WAITING_MARKER_PREFIX, DONE_MARKER_PREFIX];
    try {
      const files = await fs.readdir(CLAUDE_SESSIONS_DIR);
      for (const file of files) {
        if (prefixes.some((p) => file.startsWith(p))) {
          try {
            await fs.unlink(path.join(CLAUDE_SESSIONS_DIR, file));
          } catch {
            // Already removed
          }
        }
      }
    } catch {
      // Sessions dir doesn't exist
    }
  }
}
