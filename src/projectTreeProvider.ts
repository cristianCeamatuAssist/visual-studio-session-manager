import * as vscode from "vscode";
import * as path from "path";
import { ClaudeProcessDetector } from "./claudeProcessDetector";
import { WorkspaceRegistry } from "./workspaceRegistry";
import { HookManager } from "./hookManager";
import { ClaudeSessionStatus, WorkspaceWithStatus, SessionItem, TreeNode } from "./types";
import { CONFIG_SECTION, DEFAULT_POLLING_INTERVAL, PROJECT_ORDER_KEY } from "./constants";

export class ProjectTreeProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  readonly dropMimeTypes: readonly string[] = ["application/vnd.code.tree.claudesessionsprojects"];
  readonly dragMimeTypes: readonly string[] = ["application/vnd.code.tree.claudesessionsprojects"];

  private pollingTimer: ReturnType<typeof setInterval> | undefined;
  private detector: ClaudeProcessDetector;
  private registry: WorkspaceRegistry;
  private hookManager: HookManager;
  private extensionPath: string;
  private globalState: vscode.Memento;
  private hooksInstalled = false;
  private currentWindowFolder: string | undefined;

  constructor(
    detector: ClaudeProcessDetector,
    registry: WorkspaceRegistry,
    hookManager: HookManager,
    extensionPath: string,
    globalState: vscode.Memento
  ) {
    this.detector = detector;
    this.registry = registry;
    this.hookManager = hookManager;
    this.extensionPath = extensionPath;
    this.globalState = globalState;
  }

  setCurrentWindowFolder(folder: string | undefined): void {
    this.currentWindowFolder = folder;
  }

  setHooksInstalled(installed: boolean): void {
    this.hooksInstalled = installed;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  startPolling(intervalOverride?: number): void {
    this.stopPolling();
    const interval = intervalOverride ?? vscode.workspace
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

    // Root level = active workspaces from registry
    const workspaces = await this.registry.getActiveWorkspaces();
    if (workspaces.length === 0) {
      return [];
    }

    const sessions = await this.detector.detectSessions(this.hooksInstalled);
    const hookWaitingMarkers = await this.hookManager.getWaitingMarkers();
    const hookDoneMarkers = await this.hookManager.getDoneMarkers();

    // Clean up stale markers
    const alivePids = new Set(sessions.map((s) => s.pid));
    const aliveSessionIds = new Set(sessions.map((s) => s.sessionId));
    this.hookManager.cleanStaleMarkers(alivePids, aliveSessionIds);

    const workspacesWithStatus: WorkspaceWithStatus[] = workspaces.map((entry) => {
      const { status, sessions: matchingSessions } = this.detector.getStatusForProject(
        entry.folder,
        sessions,
        hookWaitingMarkers,
        this.hooksInstalled,
        hookDoneMarkers
      );

      const normalizedCurrent = this.currentWindowFolder?.replace(/\/+$/, "");
      const normalizedEntry = entry.folder.replace(/\/+$/, "");

      return {
        type: "project" as const,
        entry,
        displayName: entry.name,
        status,
        sessions: matchingSessions,
        sessionCount: matchingSessions.length,
        isCurrentWindow: normalizedCurrent === normalizedEntry,
      };
    });

    return this.applyOrder(workspacesWithStatus);
  }

  handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): void {
    const projects = source.filter((node): node is WorkspaceWithStatus => node.type === "project");
    if (projects.length === 0) {
      return;
    }
    dataTransfer.set(
      "application/vnd.code.tree.claudesessionsprojects",
      new vscode.DataTransferItem(projects)
    );
  }

  async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer, _token: vscode.CancellationToken): Promise<void> {
    const transferItem = dataTransfer.get("application/vnd.code.tree.claudesessionsprojects");
    if (!transferItem) {
      return;
    }

    const draggedProjects: WorkspaceWithStatus[] = transferItem.value;
    if (!draggedProjects || draggedProjects.length === 0) {
      return;
    }

    const currentOrder = this.getSavedOrder();
    if (currentOrder.length === 0) {
      return;
    }

    const draggedFolders = new Set(draggedProjects.map((p) => p.entry.folder));
    const withoutDragged = currentOrder.filter((f) => !draggedFolders.has(f));

    let insertIndex: number;
    if (target === undefined || target.type === "session") {
      insertIndex = withoutDragged.length;
    } else {
      const targetFolder = target.entry.folder;
      const targetIndex = withoutDragged.indexOf(targetFolder);
      insertIndex = targetIndex >= 0 ? targetIndex : withoutDragged.length;
    }

    const draggedInOrder = currentOrder.filter((f) => draggedFolders.has(f));
    const newOrder = [
      ...withoutDragged.slice(0, insertIndex),
      ...draggedInOrder,
      ...withoutDragged.slice(insertIndex),
    ];

    await this.saveOrder(newOrder);
    this.refresh();
  }

  private getSavedOrder(): string[] {
    return this.globalState.get<string[]>(PROJECT_ORDER_KEY, []);
  }

  private async saveOrder(folders: string[]): Promise<void> {
    await this.globalState.update(PROJECT_ORDER_KEY, folders);
  }

  private applyOrder(projects: WorkspaceWithStatus[]): WorkspaceWithStatus[] {
    const savedOrder = this.getSavedOrder();
    const byFolder = new Map<string, WorkspaceWithStatus>();
    for (const p of projects) {
      byFolder.set(p.entry.folder, p);
    }

    const ordered: WorkspaceWithStatus[] = [];

    for (const folder of savedOrder) {
      const project = byFolder.get(folder);
      if (project) {
        ordered.push(project);
        byFolder.delete(folder);
      }
    }

    for (const project of byFolder.values()) {
      ordered.push(project);
    }

    const cleanOrder = ordered.map((p) => p.entry.folder);
    if (
      cleanOrder.length !== savedOrder.length ||
      cleanOrder.some((f, i) => f !== savedOrder[i])
    ) {
      this.saveOrder(cleanOrder);
    }

    return ordered;
  }

  private getProjectTreeItem(element: WorkspaceWithStatus): vscode.TreeItem {
    const collapsible =
      element.sessionCount > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;

    const label = element.isCurrentWindow
      ? `${element.displayName} (this window)`
      : element.displayName;

    const item = new vscode.TreeItem(label, collapsible);

    const iconFile = this.getStatusIconFile(element.status);
    item.iconPath = {
      light: vscode.Uri.file(path.join(this.extensionPath, "resources", iconFile)),
      dark: vscode.Uri.file(path.join(this.extensionPath, "resources", iconFile)),
    };

    item.description = this.getStatusDescription(element);
    item.tooltip = this.buildProjectTooltip(element);
    item.contextValue = "project";

    // Only allow clicking to switch if it's NOT the current window
    if (!element.isCurrentWindow) {
      item.command = {
        command: "claudeSessions.openProject",
        title: "Open Project",
        arguments: [element],
      };
    }

    return item;
  }

  private getSessionTreeItem(element: SessionItem): vscode.TreeItem {
    const { session } = element;
    const started = this.timeAgo(session.startedAt);
    const label = `PID ${session.pid}`;

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

    if (this.hooksInstalled) {
      // Hooks mode: derive status from parent project
      const parentStatus = element.parentProject.status;
      const statusConfig = {
        [ClaudeSessionStatus.Active]: { icon: "pulse", color: "terminal.ansiYellow", label: "Working" },
        [ClaudeSessionStatus.Waiting]: { icon: "bell", color: "terminal.ansiRed", label: "Needs input" },
        [ClaudeSessionStatus.Done]: { icon: "check", color: "terminal.ansiGreen", label: "Done" },
        [ClaudeSessionStatus.Inactive]: { icon: "circle-outline", color: "terminal.ansiBrightBlack", label: "Inactive" },
      };
      const cfg = statusConfig[parentStatus];
      item.description = `${cfg.label} - ${started}`;
      item.iconPath = new vscode.ThemeIcon(cfg.icon, new vscode.ThemeColor(cfg.color));
    } else {
      // CPU mode fallback
      const isActive = session.cpuPercent > 5;
      item.description = isActive
        ? `Working (CPU: ${session.cpuPercent.toFixed(0)}%) - ${started}`
        : `Needs input - ${started}`;
      item.iconPath = new vscode.ThemeIcon(
        isActive ? "pulse" : "bell",
        isActive
          ? new vscode.ThemeColor("terminal.ansiYellow")
          : new vscode.ThemeColor("terminal.ansiRed")
      );
    }

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**Session** \`${session.sessionId.slice(0, 8)}...\`\n\n`);
    md.appendMarkdown(`- **PID:** ${session.pid}\n`);
    md.appendMarkdown(`- **CWD:** \`${session.cwd}\`\n`);
    if (!this.hooksInstalled) {
      md.appendMarkdown(`- **CPU:** ${session.cpuPercent.toFixed(1)}%\n`);
    }
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
      case ClaudeSessionStatus.Done:
        return "status-done.svg";
      case ClaudeSessionStatus.Inactive:
        return "status-inactive.svg";
    }
  }

  private getStatusDescription(project: WorkspaceWithStatus): string {
    switch (project.status) {
      case ClaudeSessionStatus.Active: {
        const countStr = project.sessionCount > 1 ? ` (${project.sessionCount} sessions)` : "";
        if (this.hooksInstalled) {
          return `Working${countStr}`;
        }
        const cpu = project.sessions[0]?.cpuPercent?.toFixed(0) ?? "?";
        return `Working - CPU: ${cpu}%${countStr}`;
      }
      case ClaudeSessionStatus.Waiting: {
        const countStr = project.sessionCount > 1 ? ` (${project.sessionCount} sessions)` : "";
        return `Needs input${countStr}`;
      }
      case ClaudeSessionStatus.Done: {
        const countStr = project.sessionCount > 1 ? ` (${project.sessionCount} sessions)` : "";
        return `Done${countStr}`;
      }
      case ClaudeSessionStatus.Inactive:
        return "No session";
    }
  }

  private buildProjectTooltip(project: WorkspaceWithStatus): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${project.displayName}**\n\n`);
    md.appendMarkdown(`Path: \`${project.entry.folder}\`\n\n`);

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
