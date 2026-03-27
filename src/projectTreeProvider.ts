import * as vscode from "vscode";
import * as path from "path";
import { ClaudeProcessDetector } from "./claudeProcessDetector";
import { ProjectManager } from "./projectManager";
import { HookManager } from "./hookManager";
import { ClaudeSessionStatus, ProjectWithStatus, SessionItem, TreeNode } from "./types";
import { CONFIG_SECTION, DEFAULT_POLLING_INTERVAL } from "./constants";

export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private pollingTimer: ReturnType<typeof setInterval> | undefined;
  private detector: ClaudeProcessDetector;
  private projectManager: ProjectManager;
  private hookManager: HookManager;
  private extensionPath: string;

  constructor(
    detector: ClaudeProcessDetector,
    projectManager: ProjectManager,
    hookManager: HookManager,
    extensionPath: string
  ) {
    this.detector = detector;
    this.projectManager = projectManager;
    this.hookManager = hookManager;
    this.extensionPath = extensionPath;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  startPolling(): void {
    this.stopPolling();
    const interval = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<number>("pollingInterval", DEFAULT_POLLING_INTERVAL);

    this.pollingTimer = setInterval(() => this.refresh(), interval);
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  dispose(): void {
    this.stopPolling();
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === "session") {
      return this.getSessionTreeItem(element);
    }
    return this.getProjectTreeItem(element);
  }

  async getChildren(element?: TreeNode): Promise<TreeNode[]> {
    // Session children (leaf nodes)
    if (element?.type === "session") {
      return [];
    }

    // Project children = its sessions
    if (element?.type === "project") {
      return element.sessions.map((session) => ({
        type: "session" as const,
        session,
        parentProject: element,
      }));
    }

    // Root level = projects
    const projects = this.projectManager.getProjects();
    if (projects.length === 0) {
      return [];
    }

    const sessions = await this.detector.detectSessions();

    // Get hook markers for accurate status detection
    const hookWaitingMarkers = await this.hookManager.getWaitingMarkers();

    // Clean up stale markers
    const alivePids = new Set(sessions.map((s) => s.pid));
    const aliveSessionIds = new Set(sessions.map((s) => s.sessionId));
    this.hookManager.cleanStaleMarkers(alivePids, aliveSessionIds);

    const projectsWithStatus: ProjectWithStatus[] = projects.map((config) => {
      const { status, sessions: matchingSessions } = this.detector.getStatusForProject(
        config.path,
        sessions,
        hookWaitingMarkers
      );
      return {
        type: "project" as const,
        config,
        displayName: config.name ?? path.basename(config.path),
        status,
        sessions: matchingSessions,
        sessionCount: matchingSessions.length,
      };
    });

    const statusOrder = {
      [ClaudeSessionStatus.Active]: 0,
      [ClaudeSessionStatus.Waiting]: 1,
      [ClaudeSessionStatus.Inactive]: 2,
    };

    projectsWithStatus.sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.displayName.localeCompare(b.displayName);
    });

    return projectsWithStatus;
  }

  private getProjectTreeItem(element: ProjectWithStatus): vscode.TreeItem {
    // Expandable if has sessions, otherwise no children
    const collapsible =
      element.sessionCount > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(element.displayName, collapsible);

    const iconFile = this.getStatusIconFile(element.status);
    item.iconPath = {
      light: vscode.Uri.file(path.join(this.extensionPath, "resources", iconFile)),
      dark: vscode.Uri.file(path.join(this.extensionPath, "resources", iconFile)),
    };

    item.description = this.getStatusDescription(element);
    item.tooltip = this.buildProjectTooltip(element);
    item.contextValue = "project";

    item.command = {
      command: "claudeSessions.openProject",
      title: "Open Project",
      arguments: [element],
    };

    return item;
  }

  private getSessionTreeItem(element: SessionItem): vscode.TreeItem {
    const { session } = element;
    const started = this.timeAgo(session.startedAt);
    const label = `PID ${session.pid}`;

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

    const isActive = session.cpuPercent > 5;
    item.description = isActive
      ? `Active (CPU: ${session.cpuPercent.toFixed(0)}%) - ${started}`
      : `Waiting - ${started}`;

    item.iconPath = new vscode.ThemeIcon(
      isActive ? "pulse" : "watch",
      isActive
        ? new vscode.ThemeColor("terminal.ansiGreen")
        : new vscode.ThemeColor("terminal.ansiYellow")
    );

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**Session** \`${session.sessionId.slice(0, 8)}...\`\n\n`);
    md.appendMarkdown(`- **PID:** ${session.pid}\n`);
    md.appendMarkdown(`- **CWD:** \`${session.cwd}\`\n`);
    md.appendMarkdown(`- **CPU:** ${session.cpuPercent.toFixed(1)}%\n`);
    md.appendMarkdown(`- **Started:** ${started}\n`);
    md.appendMarkdown(`- **Kind:** ${session.kind}\n`);
    if (session.entrypoint) {
      md.appendMarkdown(`- **Entrypoint:** ${session.entrypoint}\n`);
    }
    item.tooltip = md;

    item.contextValue = "session";

    return item;
  }

  private getStatusIconFile(status: ClaudeSessionStatus): string {
    switch (status) {
      case ClaudeSessionStatus.Active:
        return "status-active.svg";
      case ClaudeSessionStatus.Waiting:
        return "status-waiting.svg";
      case ClaudeSessionStatus.Inactive:
        return "status-inactive.svg";
    }
  }

  private getStatusDescription(project: ProjectWithStatus): string {
    switch (project.status) {
      case ClaudeSessionStatus.Active: {
        const cpu = project.sessions[0]?.cpuPercent?.toFixed(0) ?? "?";
        const countStr = project.sessionCount > 1 ? ` (${project.sessionCount} sessions)` : "";
        return `Active - CPU: ${cpu}%${countStr}`;
      }
      case ClaudeSessionStatus.Waiting: {
        const countStr = project.sessionCount > 1 ? ` (${project.sessionCount} sessions)` : "";
        return `Waiting for input${countStr}`;
      }
      case ClaudeSessionStatus.Inactive:
        return "No session";
    }
  }

  private buildProjectTooltip(project: ProjectWithStatus): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${project.displayName}**\n\n`);
    md.appendMarkdown(`Path: \`${project.config.path}\`\n\n`);

    if (project.sessions.length > 0) {
      md.appendMarkdown(`**${project.sessionCount} session(s)** - click to expand`);
    } else {
      md.appendMarkdown("_No active Claude sessions_");
    }

    return md;
  }

  private timeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}
