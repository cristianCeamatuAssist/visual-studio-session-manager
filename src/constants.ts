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
