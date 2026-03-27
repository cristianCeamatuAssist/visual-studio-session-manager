import * as vscode from "vscode";
import { ClaudeProcessDetector } from "./claudeProcessDetector";
import { CONFIG_SECTION, DEFAULT_POLLING_INTERVAL } from "./constants";

export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private detector: ClaudeProcessDetector;
  private pollingTimer: ReturnType<typeof setInterval> | undefined;

  constructor(detector: ClaudeProcessDetector) {
    this.detector = detector;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = "claudeSessionsProjects.focus";
    this.statusBarItem.name = "Claude Sessions";
  }

  async update(): Promise<void> {
    const showStatusBar = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>("showStatusBar", true);

    if (!showStatusBar) {
      this.statusBarItem.hide();
      return;
    }

    const sessions = await this.detector.detectSessions();
    const totalSessions = sessions.length;
    const activeSessions = this.detector.getActiveCount(sessions);

    if (totalSessions === 0) {
      this.statusBarItem.text = "$(terminal) Claude: 0";
      this.statusBarItem.tooltip = "No active Claude sessions";
      this.statusBarItem.color = undefined;
    } else if (activeSessions > 0) {
      this.statusBarItem.text = `$(pulse) Claude: ${totalSessions} active`;
      this.statusBarItem.tooltip = `${activeSessions} actively working, ${totalSessions - activeSessions} waiting`;
      this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiGreen");
    } else {
      this.statusBarItem.text = `$(watch) Claude: ${totalSessions} waiting`;
      this.statusBarItem.tooltip = `${totalSessions} session(s) waiting for input`;
      this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiYellow");
    }

    this.statusBarItem.show();
  }

  startPolling(): void {
    this.stopPolling();
    // Initial update
    this.update();

    const interval = vscode.workspace
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
