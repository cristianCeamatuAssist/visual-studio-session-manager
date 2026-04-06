export enum ClaudeSessionStatus {
  Active = "active",
  Waiting = "waiting",
  Done = "done",
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

export interface ProjectConfig {
  path: string;
  name?: string;
}

export interface ProjectWithStatus {
  type: "project";
  config: ProjectConfig;
  displayName: string;
  status: ClaudeSessionStatus;
  sessions: ClaudeSession[];
  sessionCount: number;
}

export interface SessionItem {
  type: "session";
  session: ClaudeSession;
  parentProject: ProjectWithStatus;
}

export type TreeNode = ProjectWithStatus | SessionItem;
