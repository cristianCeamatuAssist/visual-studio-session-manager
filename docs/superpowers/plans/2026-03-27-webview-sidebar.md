# Webview Sidebar with Hover-Expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the VS Code TreeView sidebar with a custom WebviewView that shows compact status dots by default and expands project details on hover.

**Architecture:** Register a `WebviewViewProvider` instead of a `TreeDataProvider`. The webview renders a responsive HTML/CSS/JS UI that shows colored status dots with project names. On hover, each project row expands inline to reveal CPU %, session count, and action buttons. The extension polls for session data and re-renders the full webview HTML on each update (simple, no incremental DOM patching needed — the dataset is small). The webview sends user actions (click, open terminal, remove, rename) back to the extension via `postMessage`.

**Tech Stack:** VS Code WebviewView API, HTML/CSS/JS (inline in TypeScript template literals), VS Code CSS variables for theming (`--vscode-*`), CSS transitions for hover animations.

**VS Code constraint:** The sidebar panel width is user-controlled (min ~170px). We cannot programmatically resize it. Our webview content adapts responsively: at any width it shows dots + names, and hover reveals detail overlays within the webview bounds.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/webviewProvider.ts` | `WebviewViewProvider` - manages webview lifecycle, data polling, message handling |
| Create | `src/webview/getWebviewHtml.ts` | Generates the full HTML document (template, CSS, JS) for the webview |
| Modify | `src/types.ts` | Add webview message types for extension ↔ webview communication |
| Modify | `src/extension.ts` | Replace `createTreeView` with `registerWebviewViewProvider`, rewire commands |
| Modify | `package.json` | Change view type to `"webview"`, remove tree-specific menu contributions |
| Delete | `src/projectTreeProvider.ts` | No longer needed (replaced by webviewProvider) |

---

## Task 1: Add Message Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add webview message type definitions**

Add these types at the end of `src/types.ts`:

```typescript
// Data shape sent to the webview for rendering
export interface WebviewProject {
  path: string;
  displayName: string;
  status: ClaudeSessionStatus;
  sessions: WebviewSession[];
  sessionCount: number;
}

export interface WebviewSession {
  pid: number;
  sessionId: string;
  cwd: string;
  cpuPercent: number;
  startedAgo: string;
  kind: string;
  entrypoint?: string;
}

// Messages from webview → extension
export interface WebviewActionMessage {
  type: "openProject" | "openNewWindow" | "openTerminal" | "removeProject" | "renameProject" | "autoDetect" | "addProject" | "showContextMenu";
  path?: string;
  displayName?: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx tsc --noEmit`
Expected: No new errors (existing types unchanged, new types are additive)

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add webview message types for sidebar communication"
```

---

## Task 2: Create the Webview HTML Generator

**Files:**
- Create: `src/webview/getWebviewHtml.ts`

- [ ] **Step 1: Create the webview directory**

```bash
mkdir -p /Users/cristianceamatu/wd/claude-sessions-ext/src/webview
```

- [ ] **Step 2: Create `getWebviewHtml.ts`**

This file exports a function that returns the complete HTML document string. It uses VS Code CSS variables for theming. All user-provided strings (project names, paths) are escaped via `escapeHtml`/`escapeAttr` before being placed into the template to prevent injection.

```typescript
import { WebviewProject, ClaudeSessionStatus } from "../types";

export function getWebviewHtml(projects: WebviewProject[], nonce: string): string {
  const projectRows = projects.map((p) => getProjectRowHtml(p)).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    ${getStyles()}
  </style>
</head>
<body>
  <div id="project-list">
    ${projectRows || getEmptyStateHtml()}
  </div>
  <script nonce="${nonce}">
    ${getScript()}
  </script>
</body>
</html>`;
}

function getProjectRowHtml(project: WebviewProject): string {
  const statusColor = getStatusColor(project.status);

  const sessionsHtml = project.sessions
    .map(
      (s) => `
      <div class="session-row">
        <span class="session-icon ${s.cpuPercent > 5 ? "active" : "waiting"}"></span>
        <span class="session-label">PID ${s.pid}</span>
        <span class="session-detail">${s.cpuPercent > 5 ? `CPU: ${s.cpuPercent.toFixed(0)}%` : "Waiting"} - ${escapeHtml(s.startedAgo)}</span>
      </div>`
    )
    .join("");

  const statusText = getStatusText(project);

  return `
    <div class="project-row" data-path="${escapeAttr(project.path)}" data-name="${escapeAttr(project.displayName)}">
      <div class="project-header">
        <span class="status-dot" style="background: ${statusColor};"></span>
        <span class="project-name">${escapeHtml(project.displayName)}</span>
        <span class="project-status">${escapeHtml(statusText)}</span>
      </div>
      <div class="project-detail">
        <div class="detail-path" title="${escapeAttr(project.path)}">${escapeHtml(project.path)}</div>
        ${sessionsHtml}
        <div class="detail-actions">
          <button class="action-btn" data-action="openNewWindow" title="Open in New Window">
            <svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 3v10h10V9h-1v3H4V4h3V3H3zm5 0v1h2.293L6.146 8.146l.708.708L11 4.707V7h1V3H8z" fill="currentColor"/></svg>
          </button>
          <button class="action-btn" data-action="openTerminal" title="Open Terminal">
            <svg width="14" height="14" viewBox="0 0 16 16"><path d="M2 3h12v10H2V3zm1 1v8h10V4H3zm1.5 1.5l3 2.5-3 2.5V5.5zM8 10h3v1H8v-1z" fill="currentColor"/></svg>
          </button>
          <button class="action-btn action-btn-danger" data-action="removeProject" title="Remove">
            <svg width="14" height="14" viewBox="0 0 16 16"><path d="M5.5 1l.5.5h4l.5-.5h3v1H2.5V1h3zM3 3.5h10l-.7 9.1a1 1 0 01-1 .9H4.7a1 1 0 01-1-.9L3 3.5z" fill="currentColor"/></svg>
          </button>
        </div>
      </div>
    </div>`;
}

function getEmptyStateHtml(): string {
  return `
    <div class="empty-state">
      <p>No projects added yet.</p>
      <button class="empty-btn" data-action="autoDetect">Auto-Detect from Claude History</button>
      <button class="empty-btn" data-action="addProject">Add Project Folder</button>
    </div>`;
}

function getStyles(): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      overflow-x: hidden;
    }

    #project-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px;
    }

    /* ---- Project Row ---- */
    .project-row {
      border-radius: 4px;
      cursor: pointer;
      transition: background 150ms ease;
      overflow: hidden;
    }

    .project-row:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .project-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      min-height: 28px;
    }

    /* ---- Status Dot ---- */
    .status-dot {
      width: 10px;
      height: 10px;
      min-width: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    /* ---- Project Name ---- */
    .project-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }

    /* ---- Status Text ---- */
    .project-status {
      font-size: 0.85em;
      opacity: 0.7;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ---- Detail Panel (hidden by default, shown on hover) ---- */
    .project-detail {
      max-height: 0;
      overflow: hidden;
      transition: max-height 200ms ease, padding 200ms ease, opacity 150ms ease;
      opacity: 0;
      padding: 0 8px;
      border-top: 0px solid transparent;
    }

    .project-row:hover .project-detail {
      max-height: 300px;
      opacity: 1;
      padding: 4px 8px 8px 26px;
      border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.2));
    }

    .detail-path {
      font-size: 0.8em;
      opacity: 0.6;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-bottom: 4px;
    }

    /* ---- Session Rows ---- */
    .session-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 0;
      font-size: 0.85em;
    }

    .session-icon {
      width: 7px;
      height: 7px;
      min-width: 7px;
      border-radius: 50%;
    }

    .session-icon.active { background: #4CAF50; }
    .session-icon.waiting { background: #FFC107; }

    .session-label {
      opacity: 0.8;
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
    }

    .session-detail {
      opacity: 0.6;
      font-size: 0.9em;
      margin-left: auto;
    }

    /* ---- Action Buttons ---- */
    .detail-actions {
      display: flex;
      gap: 4px;
      margin-top: 6px;
      padding-top: 4px;
      border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.12));
    }

    .action-btn {
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,0.15));
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      border: none;
      border-radius: 3px;
      padding: 4px 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 100ms ease;
    }

    .action-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,0.3));
    }

    .action-btn-danger:hover {
      background: var(--vscode-inputValidation-errorBackground, rgba(255,0,0,0.2));
      color: var(--vscode-errorForeground, #f44);
    }

    /* ---- Empty State ---- */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 24px 12px;
      text-align: center;
      opacity: 0.7;
    }

    .empty-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      padding: 6px 14px;
      cursor: pointer;
      font-size: 0.9em;
      width: 100%;
      max-width: 220px;
    }

    .empty-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
  `;
}

function getScript(): string {
  return `
    const vscode = acquireVsCodeApi();

    document.addEventListener("click", (e) => {
      const target = e.target;

      // Action button clicked
      const actionBtn = target.closest(".action-btn");
      if (actionBtn) {
        e.stopPropagation();
        const row = actionBtn.closest(".project-row");
        if (!row) return;
        vscode.postMessage({
          type: actionBtn.dataset.action,
          path: row.dataset.path,
          displayName: row.dataset.name,
        });
        return;
      }

      // Empty state buttons
      const emptyBtn = target.closest(".empty-btn");
      if (emptyBtn) {
        vscode.postMessage({ type: emptyBtn.dataset.action });
        return;
      }

      // Project row clicked — open project
      const row = target.closest(".project-row");
      if (row) {
        vscode.postMessage({ type: "openProject", path: row.dataset.path });
      }
    });

    // Right-click → context menu via extension QuickPick
    document.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".project-row");
      if (row) {
        e.preventDefault();
        vscode.postMessage({
          type: "showContextMenu",
          path: row.dataset.path,
          displayName: row.dataset.name,
        });
      }
    });
  `;
}

function getStatusColor(status: ClaudeSessionStatus): string {
  switch (status) {
    case ClaudeSessionStatus.Active:
      return "#4CAF50";
    case ClaudeSessionStatus.Waiting:
      return "#FFC107";
    case ClaudeSessionStatus.Inactive:
      return "#9E9E9E";
  }
}

function getStatusText(project: WebviewProject): string {
  switch (project.status) {
    case ClaudeSessionStatus.Active: {
      const cpu = project.sessions[0]?.cpuPercent?.toFixed(0) ?? "?";
      const count = project.sessionCount > 1 ? ` (${project.sessionCount})` : "";
      return cpu + "%" + count;
    }
    case ClaudeSessionStatus.Waiting: {
      const count = project.sessionCount > 1 ? ` (${project.sessionCount})` : "";
      return "Waiting" + count;
    }
    case ClaudeSessionStatus.Inactive:
      return "";
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/webview/getWebviewHtml.ts
git commit -m "feat: add webview HTML generator with hover-expand UI"
```

---

## Task 3: Create the WebviewViewProvider

**Files:**
- Create: `src/webviewProvider.ts`

- [ ] **Step 1: Create `webviewProvider.ts`**

This class implements `vscode.WebviewViewProvider`, manages the webview lifecycle, and handles bidirectional message passing. On each poll tick, it re-renders the full HTML (the dataset is small — typically 5-20 projects — so full re-renders are fine).

```typescript
import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { ClaudeProcessDetector } from "./claudeProcessDetector";
import { ProjectManager } from "./projectManager";
import { ClaudeSessionStatus, WebviewProject, WebviewActionMessage } from "./types";
import { CONFIG_SECTION, DEFAULT_POLLING_INTERVAL } from "./constants";
import { getWebviewHtml } from "./webview/getWebviewHtml";

export class ClaudeSessionsWebviewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = "claudeSessionsProjects";

  private view?: vscode.WebviewView;
  private detector: ClaudeProcessDetector;
  private projectManager: ProjectManager;
  private pollingTimer: ReturnType<typeof setInterval> | undefined;
  private disposables: vscode.Disposable[] = [];

  // Callbacks set by extension.ts for command handling
  public onOpenProject?: (projectPath: string) => void;
  public onOpenNewWindow?: (projectPath: string) => void;
  public onOpenTerminal?: (projectPath: string, displayName: string) => void;
  public onRemoveProject?: (projectPath: string) => void;
  public onRenameProject?: (projectPath: string, currentName: string) => void;
  public onAutoDetect?: () => void;
  public onAddProject?: () => void;
  public onShowContextMenu?: (projectPath: string, displayName: string) => void;

  constructor(detector: ClaudeProcessDetector, projectManager: ProjectManager) {
    this.detector = detector;
    this.projectManager = projectManager;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    // Handle messages from webview
    const messageDisposable = webviewView.webview.onDidReceiveMessage(
      (message: WebviewActionMessage) => {
        switch (message.type) {
          case "openProject":
            if (message.path) this.onOpenProject?.(message.path);
            break;
          case "openNewWindow":
            if (message.path) this.onOpenNewWindow?.(message.path);
            break;
          case "openTerminal":
            if (message.path) this.onOpenTerminal?.(message.path, message.displayName ?? "Terminal");
            break;
          case "removeProject":
            if (message.path) this.onRemoveProject?.(message.path);
            break;
          case "renameProject":
            if (message.path) this.onRenameProject?.(message.path, message.displayName ?? "");
            break;
          case "autoDetect":
            this.onAutoDetect?.();
            break;
          case "addProject":
            this.onAddProject?.();
            break;
          case "showContextMenu":
            if (message.path) this.onShowContextMenu?.(message.path, message.displayName ?? "");
            break;
        }
      }
    );

    this.disposables.push(messageDisposable);

    webviewView.onDidDispose(() => {
      this.view = undefined;
    });

    // Initial render
    this.updateWebview();
  }

  async updateWebview(): Promise<void> {
    if (!this.view) return;

    const projects = await this.getProjectData();
    const nonce = crypto.randomBytes(16).toString("hex");
    this.view.webview.html = getWebviewHtml(projects, nonce);
  }

  startPolling(): void {
    this.stopPolling();
    const interval = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<number>("pollingInterval", DEFAULT_POLLING_INTERVAL);

    this.pollingTimer = setInterval(() => this.updateWebview(), interval);
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  refresh(): void {
    this.updateWebview();
  }

  private async getProjectData(): Promise<WebviewProject[]> {
    const configs = this.projectManager.getProjects();
    if (configs.length === 0) return [];

    const sessions = await this.detector.detectSessions();

    const projects: WebviewProject[] = configs.map((config) => {
      const { status, sessions: matchingSessions } = this.detector.getStatusForProject(config.path, sessions);
      return {
        path: config.path,
        displayName: config.name ?? path.basename(config.path),
        status,
        sessions: matchingSessions.map((s) => ({
          pid: s.pid,
          sessionId: s.sessionId,
          cwd: s.cwd,
          cpuPercent: s.cpuPercent,
          startedAgo: this.timeAgo(s.startedAt),
          kind: s.kind,
          entrypoint: s.entrypoint,
        })),
        sessionCount: matchingSessions.length,
      };
    });

    const statusOrder = {
      [ClaudeSessionStatus.Active]: 0,
      [ClaudeSessionStatus.Waiting]: 1,
      [ClaudeSessionStatus.Inactive]: 2,
    };

    projects.sort((a, b) => {
      const diff = statusOrder[a.status] - statusOrder[b.status];
      if (diff !== 0) return diff;
      return a.displayName.localeCompare(b.displayName);
    });

    return projects;
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

  dispose(): void {
    this.stopPolling();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/webviewProvider.ts
git commit -m "feat: add WebviewViewProvider for sidebar rendering"
```

---

## Task 4: Update `package.json` — Change View Type to Webview

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Change the view type to webview**

In `package.json`, update the `views` section to declare a webview view:

```json
"views": {
  "claude-sessions": [
    {
      "type": "webview",
      "id": "claudeSessionsProjects",
      "name": "Projects"
    }
  ]
}
```

- [ ] **Step 2: Remove tree-specific menu contributions**

Remove the entire `"view/item/context"` array from the `menus` section. The webview handles its own click/context interactions. Keep the `"view/title"` toolbar buttons (auto-detect, add, refresh).

- [ ] **Step 3: Remove `viewsWelcome`**

Remove the `"viewsWelcome"` section — the webview renders its own empty state.

- [ ] **Step 4: Verify the JSON is valid**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat: change sidebar view type from tree to webview"
```

---

## Task 5: Rewire `extension.ts` — Use WebviewViewProvider

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Replace TreeView with WebviewViewProvider**

Key changes:
1. Import `ClaudeSessionsWebviewProvider` instead of `ProjectTreeProvider`
2. Use `vscode.window.registerWebviewViewProvider` instead of `vscode.window.createTreeView`
3. Wire up command callbacks via provider callback properties
4. Remove tree badge logic (webview handles its own status display)
5. Remove the `setTimeout` auto-focus (webview doesn't need it)
6. Keep all existing commands registered for command palette access
7. Right-click in the webview triggers `onShowContextMenu` which uses `vscode.window.showQuickPick` to present options natively

Full updated file:

```typescript
import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import { ClaudeProcessDetector } from "./claudeProcessDetector";
import { ProjectManager } from "./projectManager";
import { ClaudeSessionsWebviewProvider } from "./webviewProvider";
import { StatusBarManager } from "./statusBarManager";
import { CONFIG_SECTION, CPU_ACTIVE_THRESHOLD } from "./constants";

const execAsync = promisify(exec);

// Keep WindowBounds, getCurrentWindowBounds, moveWindowToBounds, switchToProject UNCHANGED

export function activate(context: vscode.ExtensionContext) {
  const cpuThreshold = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>("cpuThreshold", CPU_ACTIVE_THRESHOLD);

  const detector = new ClaudeProcessDetector(cpuThreshold);
  const projectManager = new ProjectManager();
  const webviewProvider = new ClaudeSessionsWebviewProvider(detector, projectManager);
  const statusBar = new StatusBarManager(detector);

  // Register webview provider (replaces createTreeView)
  const providerRegistration = vscode.window.registerWebviewViewProvider(
    ClaudeSessionsWebviewProvider.viewType,
    webviewProvider
  );

  // Wire up webview action callbacks
  webviewProvider.onOpenProject = async (projectPath: string) => {
    const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (currentFolder === projectPath) {
      vscode.window.showInformationMessage("Already in this project");
      return;
    }
    await switchToProject(projectPath);
  };

  webviewProvider.onOpenNewWindow = (projectPath: string) => {
    const uri = vscode.Uri.file(projectPath);
    vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
  };

  webviewProvider.onOpenTerminal = (projectPath: string, displayName: string) => {
    const terminal = vscode.window.createTerminal({ name: displayName, cwd: projectPath });
    terminal.show();
  };

  webviewProvider.onRemoveProject = async (projectPath: string) => {
    await projectManager.removeProject(projectPath);
    webviewProvider.refresh();
  };

  webviewProvider.onRenameProject = async (projectPath: string, currentName: string) => {
    const newName = await vscode.window.showInputBox({
      prompt: "Enter display name for this project",
      value: currentName,
      placeHolder: "Project name",
    });
    if (newName !== undefined) {
      await projectManager.renameProject(projectPath, newName);
      webviewProvider.refresh();
    }
  };

  const handleAutoDetect = async () => {
    const detected = await projectManager.autoDetectProjects();
    webviewProvider.refresh();
    if (detected.length > 0) {
      vscode.window.showInformationMessage(`Added ${detected.length} project(s) from Claude history`);
    } else {
      vscode.window.showInformationMessage("No new projects found");
    }
  };

  const handleAddProject = async () => {
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
      webviewProvider.refresh();
    }
  };

  webviewProvider.onAutoDetect = handleAutoDetect;
  webviewProvider.onAddProject = handleAddProject;

  webviewProvider.onShowContextMenu = async (projectPath: string, displayName: string) => {
    const choice = await vscode.window.showQuickPick(
      [
        { label: "$(multiple-windows) Open in New Window", action: "openNewWindow" as const },
        { label: "$(terminal) Open Terminal", action: "openTerminal" as const },
        { label: "$(edit) Rename", action: "rename" as const },
        { label: "$(trash) Remove", action: "remove" as const },
      ],
      { placeHolder: displayName }
    );
    if (!choice) return;
    switch (choice.action) {
      case "openNewWindow":
        webviewProvider.onOpenNewWindow?.(projectPath);
        break;
      case "openTerminal":
        webviewProvider.onOpenTerminal?.(projectPath, displayName);
        break;
      case "rename":
        webviewProvider.onRenameProject?.(projectPath, displayName);
        break;
      case "remove":
        webviewProvider.onRemoveProject?.(projectPath);
        break;
    }
  };

  // Register commands (toolbar + command palette)
  context.subscriptions.push(
    providerRegistration,
    webviewProvider,
    statusBar,

    vscode.commands.registerCommand("claudeSessions.addProject", handleAddProject),
    vscode.commands.registerCommand("claudeSessions.refreshProjects", () => webviewProvider.refresh()),
    vscode.commands.registerCommand("claudeSessions.autoDetectProjects", handleAutoDetect),

    // These are handled by webview messages but must be registered to avoid "command not found"
    vscode.commands.registerCommand("claudeSessions.removeProject", () => {}),
    vscode.commands.registerCommand("claudeSessions.openProject", () => {}),
    vscode.commands.registerCommand("claudeSessions.openProjectNewWindow", () => {}),
    vscode.commands.registerCommand("claudeSessions.renameProject", () => {}),
    vscode.commands.registerCommand("claudeSessions.openTerminal", () => {}),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        const newThreshold = vscode.workspace
          .getConfiguration(CONFIG_SECTION)
          .get<number>("cpuThreshold", CPU_ACTIVE_THRESHOLD);
        detector.setCpuThreshold(newThreshold);

        webviewProvider.stopPolling();
        webviewProvider.startPolling();

        statusBar.stopPolling();
        statusBar.startPolling();

        webviewProvider.refresh();
      }
    })
  );

  webviewProvider.startPolling();
  statusBar.startPolling();
}

export function deactivate() {}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire extension to use WebviewViewProvider instead of TreeView"
```

---

## Task 6: Delete Old TreeView Provider

**Files:**
- Delete: `src/projectTreeProvider.ts`

- [ ] **Step 1: Remove the file**

```bash
rm /Users/cristianceamatu/wd/claude-sessions-ext/src/projectTreeProvider.ts
```

- [ ] **Step 2: Verify no remaining imports**

Run: `grep -r "projectTreeProvider" /Users/cristianceamatu/wd/claude-sessions-ext/src/`
Expected: No results

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove old TreeView provider (replaced by webview)"
```

---

## Task 7: Build, Package, and Test

**Files:**
- No new files

- [ ] **Step 1: Build and package the extension**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx tsc --noEmit 2>&1 && npx @vscode/vsce package --no-dependencies --allow-missing-repository 2>&1`
Expected: VSIX file created successfully

- [ ] **Step 2: Install the extension**

Run: `code --install-extension /Users/cristianceamatu/wd/claude-sessions-ext/vscode-session-manager-0.1.0.vsix --force`
Expected: Extension installed

- [ ] **Step 3: Manual testing checklist**

After restarting VS Code (Cmd+Q, then reopen):

1. Sidebar shows the Claude Sessions icon in activity bar
2. Clicking it shows the webview with project list
3. Each project shows a colored dot (green/yellow/gray) + name
4. Hovering a project row expands to show: path, sessions, action buttons
5. Mouse leaving the row collapses the detail smoothly
6. Clicking a project switches to that folder
7. Action buttons work: Open New Window, Open Terminal, Remove
8. Right-click shows QuickPick context menu with Rename option
9. Toolbar buttons work: Auto-detect, Add Project, Refresh
10. Empty state shows correctly when no projects exist
11. Status bar still shows session count
12. Theme colors adapt correctly in both light and dark themes
13. Narrow sidebar width (~170px) still shows dots + truncated names cleanly

- [ ] **Step 4: Commit any fixes found during testing**

```bash
git add -A
git commit -m "fix: address issues found during manual testing"
```

---

## Summary

| Task | Description | Files | Estimate |
|------|-------------|-------|----------|
| 1 | Add message types | `types.ts` | 2 min |
| 2 | Create HTML generator | `webview/getWebviewHtml.ts` (new) | 5 min |
| 3 | Create WebviewViewProvider | `webviewProvider.ts` (new) | 5 min |
| 4 | Update package.json | `package.json` | 2 min |
| 5 | Rewire extension.ts | `extension.ts` | 5 min |
| 6 | Delete old TreeView | `projectTreeProvider.ts` (delete) | 1 min |
| 7 | Build, package, test | — | 5 min |
