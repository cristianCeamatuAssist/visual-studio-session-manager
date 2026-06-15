import * as path from "path";
import * as os from "os";

export const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");
export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
export const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");
export const DEFAULT_POLLING_INTERVAL = 3000;
export const CPU_ACTIVE_THRESHOLD = 5.0;
export const CONFIG_SECTION = "claudeSessions";

/** Number of consecutive below-threshold CPU readings before confirming "waiting" */
export const DEBOUNCE_READINGS = 3;

/** Prefix for hook-created waiting marker files in sessions dir */
export const WAITING_MARKER_PREFIX = ".waiting_";

/** Polling interval when hooks are installed (less frequent since file watcher handles immediacy) */
export const HOOKS_POLLING_INTERVAL = 5000;

/** Directory where VS Code window instances register themselves for auto-discovery */
export const VSCODE_WORKSPACES_DIR = path.join(os.homedir(), ".claude", "vscode-workspaces");

/** Directory for cross-window "focus this session's terminal" requests */
export const FOCUS_REQUESTS_DIR = path.join(VSCODE_WORKSPACES_DIR, "focus-requests");

/** Key used in VS Code globalState to persist user's custom project order */
export const PROJECT_ORDER_KEY = "projectOrder";

/** Key used in VS Code globalState to persist whether the tree expands all nodes by default */
export const EXPAND_ALL_KEY = "expandAll";

/** Context key toggled so the view title shows Expand-All vs Collapse-All */
export const EXPAND_ALL_CONTEXT = "claudeSessions.expanded";
