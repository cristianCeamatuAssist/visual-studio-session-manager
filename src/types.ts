export enum ClaudeSessionStatus {
  Active = "active",
  Waiting = "waiting",
  Inactive = "inactive",
}

export interface ClaudeSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: string;
  entrypoint?: string;
  cpuPercent: number;
}

export type WorkspaceKind = "folder" | "workspace";

export interface WorkspaceEntry {
  pid: number;
  /** First workspace folder — kept as the stable key for ordering and legacy compatibility. */
  folder: string;
  folders: string[];
  name: string;
  kind: WorkspaceKind;
  workspaceFile?: string;
  lastSeen: number;
}

export interface WorkspaceRegistrationInput {
  pid: number;
  folders: string[];
  name: string;
  kind: WorkspaceKind;
  workspaceFile?: string;
}

export interface WorkspaceWithStatus {
  type: "project";
  entry: WorkspaceEntry;
  displayName: string;
  status: ClaudeSessionStatus;
  sessions: ClaudeSession[];
  sessionCount: number;
  isCurrentWindow: boolean;
  /** Main repository root when this window is a git worktree. */
  worktreeOf?: string;
  /** Worktree windows nested under this project in the tree. */
  worktrees: WorkspaceWithStatus[];
}

export interface SessionItem {
  type: "session";
  session: ClaudeSession;
  parentProject: WorkspaceWithStatus;
}

export type TreeNode = WorkspaceWithStatus | SessionItem;
