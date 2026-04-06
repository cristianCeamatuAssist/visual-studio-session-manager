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
      // Check for done markers (recently completed sessions)
      if (this.hooksInstalled) {
        const doneMarkers = await this.hookManager.getDoneMarkers();
        if (doneMarkers.size > 0) {
          this.statusBarItem.text = `$(check) Claude: done`;
          this.statusBarItem.tooltip = `${doneMarkers.size} session(s) completed`;
          this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiGreen");
          this.statusBarItem.show();
          return;
        }
      }
      this.statusBarItem.text = "$(terminal) Claude: 0";
      this.statusBarItem.tooltip = "No active Claude sessions";
      this.statusBarItem.color = undefined;
    } else if (this.hooksInstalled) {
      // Hooks mode: 3-state detection using markers
      const waitingMarkers = await this.hookManager.getWaitingMarkers();
      const doneMarkers = await this.hookManager.getDoneMarkers();

      const waitingCount = sessions.filter(
        (s) => waitingMarkers.has(String(s.pid)) || waitingMarkers.has(s.sessionId)
      ).length;
      const doneCount = sessions.filter(
        (s) => doneMarkers.has(String(s.pid)) || doneMarkers.has(s.sessionId)
      ).length;
      const activeCount = totalSessions - waitingCount - doneCount;

      if (activeCount > 0) {
        // Orange: at least one session is working
        this.statusBarItem.text = `$(pulse) Claude: ${totalSessions} working`;
        this.statusBarItem.tooltip = `${activeCount} working, ${waitingCount} need input, ${doneCount} done`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiYellow");
      } else if (waitingCount > 0) {
        // Red: all sessions are waiting for input
        this.statusBarItem.text = `$(bell) Claude: ${waitingCount} need input`;
        this.statusBarItem.tooltip = `${waitingCount} session(s) need your input`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiRed");
      } else {
        // Green: all sessions are done
        this.statusBarItem.text = `$(check) Claude: ${doneCount} done`;
        this.statusBarItem.tooltip = `${doneCount} session(s) completed`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiGreen");
      }
    } else {
      // CPU mode fallback: orange = working, red = needs input
      const activeSessions = this.detector.getActiveCount(sessions);
      if (activeSessions > 0) {
        this.statusBarItem.text = `$(pulse) Claude: ${totalSessions} working`;
        this.statusBarItem.tooltip = `${activeSessions} working, ${totalSessions - activeSessions} need input`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiYellow");
      } else {
        this.statusBarItem.text = `$(bell) Claude: ${totalSessions} need input`;
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
