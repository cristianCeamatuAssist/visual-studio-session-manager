import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { ClaudeProcessDetector } from "./claudeProcessDetector";
import { ProjectManager } from "./projectManager";
import { ProjectTreeProvider } from "./projectTreeProvider";
import { StatusBarManager } from "./statusBarManager";
import { HookManager } from "./hookManager";
import { CONFIG_SECTION, CPU_ACTIVE_THRESHOLD, CLAUDE_SESSIONS_DIR, HOOKS_POLLING_INTERVAL } from "./constants";
import { ProjectWithStatus } from "./types";

const execAsync = promisify(exec);

interface WindowBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Get the current VS Code front window position and size via AppleScript.
 */
async function getCurrentWindowBounds(): Promise<WindowBounds | null> {
  if (process.platform !== "darwin") return null;

  try {
    const { stdout } = await execAsync(`osascript -e '
      tell application "System Events"
        tell process "Code"
          set frontWin to front window
          set {x, y} to position of frontWin
          set {w, h} to size of frontWin
          return (x as text) & "," & (y as text) & "," & (w as text) & "," & (h as text)
        end tell
      end tell'`);

    const parts = stdout.trim().split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  } catch {
    // AppleScript failed (permissions, etc.)
  }

  return null;
}

/**
 * Move the current VS Code front window to the given position and size.
 * Retries a few times since the new window may take time to fully appear.
 */
async function moveWindowToBounds(bounds: WindowBounds): Promise<void> {
  if (process.platform !== "darwin") return;

  const script = `osascript -e '
    tell application "System Events"
      tell process "Code"
        set position of front window to {${bounds.x}, ${bounds.y}}
        set size of front window to {${bounds.w}, ${bounds.h}}
      end tell
    end tell'`;

  // Try 3 times with increasing delays to catch the new window
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await execAsync(script);
    } catch {
      // Best effort
    }
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/**
 * Switch to a project: captures current window bounds, opens the project,
 * then moves the new window to the exact same spot for seamless switching.
 */
async function switchToProject(projectPath: string): Promise<void> {
  if (process.platform === "darwin") {
    try {
      // 1. Capture current window position/size
      const bounds = await getCurrentWindowBounds();

      // 2. Open the project (reuses existing window or opens new)
      await execAsync(`open -a "Visual Studio Code" "${projectPath}"`);

      // 3. If we captured bounds, reposition the new/focused window to same spot
      if (bounds) {
        // Wait for VS Code to open/focus the window
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await moveWindowToBounds(bounds);
      }

      return;
    } catch {
      // Fallback
    }
  }

  const uri = vscode.Uri.file(projectPath);
  vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
}

export function activate(context: vscode.ExtensionContext) {
  const cpuThreshold = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>("cpuThreshold", CPU_ACTIVE_THRESHOLD);

  const detector = new ClaudeProcessDetector(cpuThreshold);
  const projectManager = new ProjectManager();
  const hookManager = new HookManager();
  const treeProvider = new ProjectTreeProvider(detector, projectManager, hookManager, context.extensionPath);
  const statusBar = new StatusBarManager(detector, hookManager);

  // Cache hooks state and propagate to components
  let hooksInstalled = false;
  const updateHooksState = async () => {
    const installed = await hookManager.isInstalled();
    if (installed !== hooksInstalled) {
      hooksInstalled = installed;
      treeProvider.setHooksInstalled(installed);
      statusBar.setHooksInstalled(installed);

      // Restart polling with appropriate interval
      const interval = installed ? HOOKS_POLLING_INTERVAL : undefined;
      treeProvider.stopPolling();
      treeProvider.startPolling(interval);
      statusBar.stopPolling();
      statusBar.startPolling(interval);
    }
  };

  // Initial check
  updateHooksState();

  // Register tree view
  const treeView = vscode.window.createTreeView("claudeSessionsProjects", {
    treeDataProvider: treeProvider,
    showCollapseAll: false,
  });

  // Auto-open the Claude Sessions sidebar so it's ready in every window
  setTimeout(() => {
    vscode.commands.executeCommand("claudeSessionsProjects.focus");
  }, 500);

  // Update badge on tree view when sessions change
  const updateBadge = async () => {
    const sessions = await detector.detectSessions(hooksInstalled);
    const count = sessions.length;
    treeView.badge = count > 0 ? { value: count, tooltip: `${count} Claude session(s)` } : undefined;
  };

  // Register commands
  context.subscriptions.push(
    treeView,
    treeProvider,
    statusBar,

    vscode.commands.registerCommand("claudeSessions.addProject", async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: true,
        openLabel: "Add Project",
      });
      if (uris) {
        for (const uri of uris) {
          await projectManager.addProject(uri.fsPath);
        }
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand("claudeSessions.removeProject", async (item: ProjectWithStatus) => {
      if (item?.config?.path) {
        await projectManager.removeProject(item.config.path);
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand("claudeSessions.refreshProjects", () => {
      treeProvider.refresh();
      updateBadge();
    }),

    // Default click: switch to existing window or open new, repositioned in-place
    vscode.commands.registerCommand("claudeSessions.openProject", async (item: ProjectWithStatus) => {
      if (item?.config?.path) {
        const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (currentFolder === item.config.path) {
          vscode.window.showInformationMessage(`Already in ${item.displayName}`);
          return;
        }
        await switchToProject(item.config.path);
      }
    }),

    // Explicit "new window" from context menu
    vscode.commands.registerCommand("claudeSessions.openProjectNewWindow", (item: ProjectWithStatus) => {
      if (item?.config?.path) {
        const uri = vscode.Uri.file(item.config.path);
        vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
      }
    }),

    vscode.commands.registerCommand("claudeSessions.renameProject", async (item: ProjectWithStatus) => {
      if (item?.config?.path) {
        const newName = await vscode.window.showInputBox({
          prompt: "Enter display name for this project",
          value: item.displayName,
          placeHolder: "Project name",
        });
        if (newName !== undefined) {
          await projectManager.renameProject(item.config.path, newName);
          treeProvider.refresh();
        }
      }
    }),

    vscode.commands.registerCommand("claudeSessions.openTerminal", (item: ProjectWithStatus) => {
      if (item?.config?.path) {
        const terminal = vscode.window.createTerminal({
          name: item.displayName,
          cwd: item.config.path,
        });
        terminal.show();
      }
    }),

    vscode.commands.registerCommand("claudeSessions.autoDetectProjects", async () => {
      const detected = await projectManager.autoDetectProjects();
      treeProvider.refresh();
      if (detected.length > 0) {
        vscode.window.showInformationMessage(
          `Added ${detected.length} project(s) from Claude history`
        );
      } else {
        vscode.window.showInformationMessage("No new projects found");
      }
    }),

    vscode.commands.registerCommand("claudeSessions.installHooks", async () => {
      const success = await hookManager.installHooks();
      if (success) {
        vscode.window.showInformationMessage(
          "Claude CLI hooks installed. Session status detection is now more accurate. " +
          "New Claude sessions will report precise waiting/active states."
        );
      } else {
        vscode.window.showErrorMessage(
          "Failed to install Claude CLI hooks. Check that ~/.claude/ directory exists."
        );
      }
    }),

    vscode.commands.registerCommand("claudeSessions.uninstallHooks", async () => {
      const success = await hookManager.uninstallHooks();
      if (success) {
        vscode.window.showInformationMessage("Claude CLI hooks removed.");
      } else {
        vscode.window.showErrorMessage("Failed to remove Claude CLI hooks.");
      }
    }),

    // Listen for config changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        const newThreshold = vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<number>("cpuThreshold", CPU_ACTIVE_THRESHOLD);
        detector.setCpuThreshold(newThreshold);

        const interval = hooksInstalled ? HOOKS_POLLING_INTERVAL : undefined;
        treeProvider.stopPolling();
        treeProvider.startPolling(interval);

        statusBar.stopPolling();
        statusBar.startPolling(interval);

        treeProvider.refresh();
      }
    })
  );

  // Start polling
  treeProvider.startPolling();
  statusBar.startPolling();

  // Initial badge update
  updateBadge();

  // Also update badge on each tree refresh (piggyback on polling)
  const badgeInterval = setInterval(updateBadge, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(badgeInterval) });

  // Watch ~/.claude/sessions/ for marker file changes so all windows sync immediately
  const sessionsPattern = new vscode.RelativePattern(
    vscode.Uri.file(CLAUDE_SESSIONS_DIR),
    "**"
  );
  const sessionsWatcher = vscode.workspace.createFileSystemWatcher(sessionsPattern);
  let refreshDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  const debouncedRefresh = () => {
    if (refreshDebounceTimer) {
      clearTimeout(refreshDebounceTimer);
    }
    refreshDebounceTimer = setTimeout(() => {
      updateHooksState();
      treeProvider.refresh();
      statusBar.update();
      updateBadge();
    }, 300);
  };
  sessionsWatcher.onDidCreate(debouncedRefresh);
  sessionsWatcher.onDidDelete(debouncedRefresh);
  sessionsWatcher.onDidChange(debouncedRefresh);
  context.subscriptions.push(sessionsWatcher, { dispose: () => {
    if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
  }});

  // Suggest hook installation if not installed — show once per version
  hookManager.isInstalled().then((installed) => {
    if (!installed) {
      const hasShownKey = "hookSuggestionShown_v0.2.1";
      const hasShown = context.globalState.get<boolean>(hasShownKey, false);
      if (!hasShown) {
        context.globalState.update(hasShownKey, true);
        vscode.window
          .showInformationMessage(
            "Install Claude CLI hooks for accurate session status detection? " +
            "(Eliminates flickering — uses lifecycle events instead of CPU monitoring)",
            "Install Hooks",
            "Not Now"
          )
          .then((choice) => {
            if (choice === "Install Hooks") {
              vscode.commands.executeCommand("claudeSessions.installHooks");
            }
          });
      }
    }
  });
}

export function deactivate() {
  // Cleanup handled by disposables
}
