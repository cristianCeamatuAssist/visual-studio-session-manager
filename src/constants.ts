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

/** Prefix for hook-created done marker files in sessions dir */
export const DONE_MARKER_PREFIX = ".done_";

/** Polling interval when hooks are installed (less frequent since file watcher handles immediacy) */
export const HOOKS_POLLING_INTERVAL = 5000;

/** How long to keep .done_ markers after a session ends (ms) */
export const DONE_MARKER_TTL = 5 * 60 * 1000;

/** Directory where VS Code window instances register themselves for auto-discovery */
export const VSCODE_WORKSPACES_DIR = path.join(os.homedir(), ".claude", "vscode-workspaces");

/** Key used in VS Code globalState to persist user's custom project order */
export const PROJECT_ORDER_KEY = "projectOrder";
