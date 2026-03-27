import * as path from "path";
import * as os from "os";

export const CLAUDE_SESSIONS_DIR = path.join(os.homedir(), ".claude", "sessions");
export const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");
export const DEFAULT_POLLING_INTERVAL = 3000;
export const CPU_ACTIVE_THRESHOLD = 5.0;
export const CONFIG_SECTION = "claudeSessions";
