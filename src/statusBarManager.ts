import * as vscode from "vscode";
import { ClaudeProcessDetector } from "./claudeProcessDetector";
import { HookManager } from "./hookManager";
import { CONFIG_SECTION, DEFAULT_POLLING_INTERVAL } from "./constants";

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private detector: ClaudeProcessDetector;
  private hookManager: HookManager;
  private pollingTimer: ReturnType<typeof setInterval> | undefined;
  private hooksInstalled = false;

  constructor(detector: ClaudeProcessDetector, hookManager: HookManager) {
    this.detector = detector;
    this.hookManager = hookManager;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = "claudeSessionsProjects.focus";
    this.statusBarItem.name = "Claude Sessions";
  }

  setHooksInstalled(installed: boolean): void {
    this.hooksInstalled = installed;
  }

  async update(): Promise<void> {
    const showStatusBar = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>("showStatusBar", true);

    if (!showStatusBar) {
      this.statusBarItem.hide();
      return;
    }

    const sessions = await this.detector.detectSessions(this.hooksInstalled);
    const totalSessions = sessions.length;

    if (totalSessions === 0) {
      this.statusBarItem.text = "$(terminal) Claude: 0";
      this.statusBarItem.tooltip = "No active Claude sessions";
      this.statusBarItem.color = undefined;
    } else if (this.hooksInstalled) {
      // Hooks mode: use markers to determine active vs waiting
      const markers = await this.hookManager.getWaitingMarkers();
      const waitingCount = sessions.filter(
        (s) => markers.has(String(s.pid)) || markers.has(s.sessionId)
      ).length;
      const activeCount = totalSessions - waitingCount;

      if (activeCount > 0) {
        this.statusBarItem.text = `$(pulse) Claude: ${totalSessions} working`;
        this.statusBarItem.tooltip = `${activeCount} working, ${waitingCount} need input`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiYellow");
      } else {
        this.statusBarItem.text = `$(watch) Claude: ${totalSessions} need input`;
        this.statusBarItem.tooltip = `${totalSessions} session(s) need your input`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiRed");
      }
    } else {
      // CPU mode: existing logic (yellow = working, red = needs input)
      const activeSessions = this.detector.getActiveCount(sessions);
      if (activeSessions > 0) {
        this.statusBarItem.text = `$(pulse) Claude: ${totalSessions} working`;
        this.statusBarItem.tooltip = `${activeSessions} working, ${totalSessions - activeSessions} need input`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiYellow");
      } else {
        this.statusBarItem.text = `$(watch) Claude: ${totalSessions} need input`;
        this.statusBarItem.tooltip = `${totalSessions} session(s) need your input`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiRed");
      }
    }

    this.statusBarItem.show();
  }

  startPolling(intervalOverride?: number): void {
    this.stopPolling();
    this.update();

    const interval = intervalOverride ?? vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<number>("pollingInterval", DEFAULT_POLLING_INTERVAL);

    this.pollingTimer = setInterval(() => this.update(), interval);
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  dispose(): void {
    this.stopPolling();
    this.statusBarItem.dispose();
  }
}
