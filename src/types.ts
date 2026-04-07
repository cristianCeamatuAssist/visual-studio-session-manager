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

export interface WorkspaceEntry {
  pid: number;
  folder: string;
  name: string;
  lastSeen: number;
}

export interface WorkspaceWithStatus {
  type: "project";
  entry: WorkspaceEntry;
  displayName: string;
  status: ClaudeSessionStatus;
  sessions: ClaudeSession[];
  sessionCount: number;
  isCurrentWindow: boolean;
}

export interface SessionItem {
  type: "session";
  session: ClaudeSession;
  parentProject: WorkspaceWithStatus;
}

export type TreeNode = WorkspaceWithStatus | SessionItem;
