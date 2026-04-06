# Auto-Discover Active VS Code Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual project management with automatic discovery of all open VS Code windows, so the sidebar always shows exactly which workspaces are currently open with their Claude session status.

**Architecture:** Each VS Code window's extension instance writes a registration file to `~/.claude/vscode-workspaces/<pid>.json` on activation. All instances read that directory to discover other open windows. Stale entries (dead PIDs) are cleaned on every poll. The `+` button opens a folder picker then uses `vscode.openFolder` API to launch a new VS Code window (which auto-registers). The `ProjectManager` class and stored `claudeSessions.projects` config are removed entirely.

**Tech Stack:** VS Code Extension API, Node.js `fs/promises`, `process.kill` for PID liveness checks, FileSystemWatcher for cross-window sync.

---

## Review Notes (from plan review)

The following issues were identified during review and must be addressed during implementation:

1. **[Critical] Preserve `ClaudeSessionStatus.Done` handling** — The replacement code in Task 3 must include `Done` in `statusOrder`, `getStatusDescription`, and pass `hookDoneMarkers` as 5th arg to `getStatusForProject()`. The current codebase handles all four statuses; dropping `Done` is a silent regression.

2. **[Critical] Fix broken `promisify` mock in tests** — Task 2's test mock `promisify: (fn: unknown) => fn` is genuinely broken — it makes the exec call with no callback, crashing on `callback(...)`. Use the same Promise-wrapping pattern from `claudeProcessDetector.test.ts`. (Moot if `process.kill(pid, 0)` is adopted per note 3.)

3. **[Important] Use `process.kill(pid, 0)` instead of shell `kill -0`** — The plan's `isPidAlive()` spawns a shell process per PID. Node.js `process.kill(pid, 0)` is zero-cost, synchronous, and eliminates the need for `child_process`, `util/promisify`, and their complex test mocks.

4. **[Important] Ensure registry directory exists before FileSystemWatcher** — On fresh install, `~/.claude/vscode-workspaces/` doesn't exist. Creating a watcher on a non-existent directory silently watches nothing. Add `await fs.mkdir(VSCODE_WORKSPACES_DIR, { recursive: true })` before creating the watcher in Task 4 Step 6.

5. **[Important] Fix command injection in `code` command** — Task 4 Step 4 uses string interpolation in a shell command which is vulnerable to shell metacharacters. Use `execFile("code", [folderPath])` or prefer the VS Code API fallback (`vscode.openFolder`) as the primary path. The codebase provides `src/utils/execFileNoThrow.ts` as a safe alternative.

6. **[Important] Add ProjectTreeProvider tests** — The plan deletes `projectManager.test.ts` but adds no tests for the rewritten tree provider. Add tests for `isCurrentWindow` labeling, status sorting (all 4 statuses), and `getStatusDescription` output.

7. **[Minor] `deactivate()` should use ES imports and `VSCODE_WORKSPACES_DIR` constant** — The plan's `deactivate()` uses `require("fs")` and hardcodes the path. Import `fs` (sync) at module top level and reference the constant.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/workspaceRegistry.ts` | Register/unregister/heartbeat for this VS Code instance; read all active workspaces; clean stale PIDs |
| Create | `src/__tests__/workspaceRegistry.test.ts` | Tests for WorkspaceRegistry |
| Create | `src/__tests__/projectTreeProvider.test.ts` | Tests for ProjectTreeProvider rendering logic |
| Modify | `src/constants.ts` | Add `VSCODE_WORKSPACES_DIR` constant |
| Modify | `src/types.ts` | Add `WorkspaceEntry` type, remove `ProjectConfig` |
| Modify | `src/extension.ts` | Wire registry lifecycle, replace commands, add registry file watcher |
| Modify | `src/projectTreeProvider.ts` | Read from WorkspaceRegistry instead of ProjectManager |
| Modify | `package.json` | Remove old commands/config, update menus |
| Modify | `src/__tests__/__mocks__/vscode.ts` | Remove `projects` from config store |
| Delete | `src/projectManager.ts` | No longer needed |
| Delete | `src/__tests__/projectManager.test.ts` | No longer needed |

---

### Task 1: Add Types and Constants

**Files:**
- Modify: `src/types.ts`
- Modify: `src/constants.ts`

- [ ] **Step 1: Write the failing test**

No test needed — these are pure type/constant definitions.

- [ ] **Step 2: Add `WorkspaceEntry` type to `src/types.ts`**

Replace `ProjectConfig` with `WorkspaceEntry` and update `ProjectWithStatus` to use it:

```typescript
// Remove this:
export interface ProjectConfig {
  path: string;
  name?: string;
}

// Add this:
export interface WorkspaceEntry {
  pid: number;
  folder: string;
  name: string;
  lastSeen: number;
}

// Update ProjectWithStatus — rename to WorkspaceWithStatus:
export interface WorkspaceWithStatus {
  type: "project";
  entry: WorkspaceEntry;
  displayName: string;
  status: ClaudeSessionStatus;
  sessions: ClaudeSession[];
  sessionCount: number;
  isCurrentWindow: boolean;
}

// Update SessionItem:
export interface SessionItem {
  type: "session";
  session: ClaudeSession;
  parentProject: WorkspaceWithStatus;
}

export type TreeNode = WorkspaceWithStatus | SessionItem;
```

- [ ] **Step 3: Add registry directory constant to `src/constants.ts`**

Add this line after the existing constants:

```typescript
export const VSCODE_WORKSPACES_DIR = path.join(os.homedir(), ".claude", "vscode-workspaces");
```

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/constants.ts
git commit -m "feat: add WorkspaceEntry type and registry directory constant"
```

---

### Task 2: Create WorkspaceRegistry

**Files:**
- Create: `src/workspaceRegistry.ts`
- Create: `src/__tests__/workspaceRegistry.test.ts`

- [ ] **Step 1: Write the failing tests for WorkspaceRegistry**

Create `src/__tests__/workspaceRegistry.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  stat: vi.fn(),
}));

// [Review note 3] No child_process or util mocks needed — isPidAlive uses process.kill(pid, 0)

import * as fs from "fs/promises";
import { WorkspaceRegistry } from "../workspaceRegistry";

const mockedMkdir = vi.mocked(fs.mkdir);
const mockedWriteFile = vi.mocked(fs.writeFile);
const mockedReaddir = vi.mocked(fs.readdir);
const mockedReadFile = vi.mocked(fs.readFile);
const mockedUnlink = vi.mocked(fs.unlink);

describe("WorkspaceRegistry", () => {
  let registry: WorkspaceRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedMkdir.mockResolvedValue(undefined);
    mockedWriteFile.mockResolvedValue(undefined);
    mockedUnlink.mockResolvedValue(undefined);
    registry = new WorkspaceRegistry();
  });

  describe("register", () => {
    it("creates directory and writes registration file", async () => {
      await registry.register(12345, "/Users/test/my-project");

      expect(mockedMkdir).toHaveBeenCalledWith(
        expect.stringContaining("vscode-workspaces"),
        { recursive: true }
      );
      expect(mockedWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("12345.json"),
        expect.stringContaining("/Users/test/my-project"),
        "utf-8"
      );
    });

    it("normalizes trailing slashes", async () => {
      await registry.register(12345, "/Users/test/my-project/");

      const writtenContent = JSON.parse(
        mockedWriteFile.mock.calls[0][1] as string
      );
      expect(writtenContent.folder).toBe("/Users/test/my-project");
    });

    it("uses folder basename as name", async () => {
      await registry.register(12345, "/Users/test/my-project");

      const writtenContent = JSON.parse(
        mockedWriteFile.mock.calls[0][1] as string
      );
      expect(writtenContent.name).toBe("my-project");
    });
  });

  describe("unregister", () => {
    it("deletes the registration file", async () => {
      await registry.unregister(12345);

      expect(mockedUnlink).toHaveBeenCalledWith(
        expect.stringContaining("12345.json")
      );
    });

    it("does not throw if file does not exist", async () => {
      mockedUnlink.mockRejectedValue(new Error("ENOENT"));

      await expect(registry.unregister(99999)).resolves.not.toThrow();
    });
  });

  describe("heartbeat", () => {
    it("updates lastSeen timestamp in the file", async () => {
      await registry.heartbeat(12345, "/Users/test/my-project");

      expect(mockedWriteFile).toHaveBeenCalledWith(
        expect.stringContaining("12345.json"),
        expect.any(String),
        "utf-8"
      );

      const writtenContent = JSON.parse(
        mockedWriteFile.mock.calls[0][1] as string
      );
      expect(writtenContent.lastSeen).toBeGreaterThan(0);
    });
  });

  describe("getActiveWorkspaces", () => {
    it("returns entries for alive PIDs", async () => {
      const entry = JSON.stringify({
        pid: 12345,
        folder: "/Users/test/project-a",
        name: "project-a",
        lastSeen: Date.now(),
      });

      mockedReaddir.mockResolvedValue(
        ["12345.json"] as unknown as ReturnType<typeof fs.readdir>
      );
      mockedReadFile.mockResolvedValue(entry);
      // [Review note 3] PID is alive — process.kill(pid, 0) succeeds silently
      vi.spyOn(process, "kill").mockReturnValue(true);

      const workspaces = await registry.getActiveWorkspaces();
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].folder).toBe("/Users/test/project-a");
    });

    it("removes stale entries for dead PIDs", async () => {
      const entry = JSON.stringify({
        pid: 99999,
        folder: "/Users/test/dead-project",
        name: "dead-project",
        lastSeen: Date.now() - 60000,
      });

      mockedReaddir.mockResolvedValue(
        ["99999.json"] as unknown as ReturnType<typeof fs.readdir>
      );
      mockedReadFile.mockResolvedValue(entry);
      // [Review note 3] PID is dead — process.kill(pid, 0) throws
      vi.spyOn(process, "kill").mockImplementation(() => { throw new Error("ESRCH"); });

      const workspaces = await registry.getActiveWorkspaces();
      expect(workspaces).toHaveLength(0);
      expect(mockedUnlink).toHaveBeenCalledWith(
        expect.stringContaining("99999.json")
      );
    });

    it("skips non-json files", async () => {
      mockedReaddir.mockResolvedValue(
        [".DS_Store", "12345.json"] as unknown as ReturnType<typeof fs.readdir>
      );
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          pid: 12345,
          folder: "/Users/test/project",
          name: "project",
          lastSeen: Date.now(),
        })
      );
      vi.spyOn(process, "kill").mockReturnValue(true);

      const workspaces = await registry.getActiveWorkspaces();
      expect(workspaces).toHaveLength(1);
    });

    it("returns empty array when directory does not exist", async () => {
      mockedReaddir.mockRejectedValue(new Error("ENOENT"));

      const workspaces = await registry.getActiveWorkspaces();
      expect(workspaces).toHaveLength(0);
    });

    it("deduplicates workspaces by folder path", async () => {
      mockedReaddir.mockResolvedValue(
        ["111.json", "222.json"] as unknown as ReturnType<typeof fs.readdir>
      );
      mockedReadFile.mockImplementation(async (filePath) => {
        const fp = filePath.toString();
        if (fp.includes("111.json")) {
          return JSON.stringify({
            pid: 111,
            folder: "/Users/test/same-project",
            name: "same-project",
            lastSeen: Date.now(),
          });
        }
        return JSON.stringify({
          pid: 222,
          folder: "/Users/test/same-project",
          name: "same-project",
          lastSeen: Date.now() - 1000,
        });
      });
      vi.spyOn(process, "kill").mockReturnValue(true);

      const workspaces = await registry.getActiveWorkspaces();
      // Should keep the most recent (PID 111)
      expect(workspaces).toHaveLength(1);
      expect(workspaces[0].pid).toBe(111);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/__tests__/workspaceRegistry.test.ts`
Expected: FAIL — `workspaceRegistry` module not found.

- [ ] **Step 3: Write WorkspaceRegistry implementation**

Create `src/workspaceRegistry.ts`:

```typescript
import * as fs from "fs/promises";
import * as path from "path";
import { VSCODE_WORKSPACES_DIR } from "./constants";
import { WorkspaceEntry } from "./types";
// [Review note 3] No child_process needed — using process.kill(pid, 0) for PID liveness

export class WorkspaceRegistry {
  async register(pid: number, folderPath: string): Promise<void> {
    await fs.mkdir(VSCODE_WORKSPACES_DIR, { recursive: true });

    const normalized = folderPath.replace(/\/+$/, "");
    const entry: WorkspaceEntry = {
      pid,
      folder: normalized,
      name: path.basename(normalized),
      lastSeen: Date.now(),
    };

    await fs.writeFile(
      path.join(VSCODE_WORKSPACES_DIR, `${pid}.json`),
      JSON.stringify(entry),
      "utf-8"
    );
  }

  async unregister(pid: number): Promise<void> {
    try {
      await fs.unlink(path.join(VSCODE_WORKSPACES_DIR, `${pid}.json`));
    } catch {
      // File may not exist — that's fine
    }
  }

  async heartbeat(pid: number, folderPath: string): Promise<void> {
    await this.register(pid, folderPath);
  }

  async getActiveWorkspaces(): Promise<WorkspaceEntry[]> {
    let files: string[];
    try {
      const entries = await fs.readdir(VSCODE_WORKSPACES_DIR);
      files = entries.filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }

    const workspaces: WorkspaceEntry[] = [];

    for (const file of files) {
      try {
        const content = await fs.readFile(
          path.join(VSCODE_WORKSPACES_DIR, file),
          "utf-8"
        );
        const entry = JSON.parse(content) as WorkspaceEntry;

        if (!entry.pid || !entry.folder) continue;

        const alive = this.isPidAlive(entry.pid);
        if (!alive) {
          // Clean up stale entry
          await fs.unlink(path.join(VSCODE_WORKSPACES_DIR, file)).catch(() => {});
          continue;
        }

        workspaces.push(entry);
      } catch {
        // Skip corrupt files
      }
    }

    // Deduplicate by folder path — keep the entry with the most recent lastSeen
    const byFolder = new Map<string, WorkspaceEntry>();
    for (const entry of workspaces) {
      const existing = byFolder.get(entry.folder);
      if (!existing || entry.lastSeen > existing.lastSeen) {
        byFolder.set(entry.folder, entry);
      }
    }

    return Array.from(byFolder.values());
  }

  // [Review note 3] process.kill(pid, 0) is zero-cost, synchronous, cross-platform
  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/__tests__/workspaceRegistry.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workspaceRegistry.ts src/__tests__/workspaceRegistry.test.ts
git commit -m "feat: add WorkspaceRegistry for auto-discovering open VS Code windows"
```

---

### Task 3: Update ProjectTreeProvider to Use WorkspaceRegistry

**Files:**
- Modify: `src/projectTreeProvider.ts`

- [ ] **Step 1: Update imports and constructor**

Replace `ProjectManager` dependency with `WorkspaceRegistry` in the constructor. Change the type references from `ProjectWithStatus` to `WorkspaceWithStatus`.

In `src/projectTreeProvider.ts`, update the imports:

```typescript
import { ClaudeProcessDetector } from "./claudeProcessDetector";
import { WorkspaceRegistry } from "./workspaceRegistry";
import { HookManager } from "./hookManager";
import { ClaudeSessionStatus, WorkspaceWithStatus, SessionItem, TreeNode } from "./types";
import { CONFIG_SECTION, DEFAULT_POLLING_INTERVAL } from "./constants";
```

Update the class fields and constructor:

```typescript
export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private pollingTimer: ReturnType<typeof setInterval> | undefined;
  private detector: ClaudeProcessDetector;
  private registry: WorkspaceRegistry;
  private hookManager: HookManager;
  private extensionPath: string;
  private hooksInstalled = false;
  private currentWindowFolder: string | undefined;

  constructor(
    detector: ClaudeProcessDetector,
    registry: WorkspaceRegistry,
    hookManager: HookManager,
    extensionPath: string
  ) {
    this.detector = detector;
    this.registry = registry;
    this.hookManager = hookManager;
    this.extensionPath = extensionPath;
  }

  setCurrentWindowFolder(folder: string | undefined): void {
    this.currentWindowFolder = folder;
  }
```

- [ ] **Step 2: Update `getChildren` to read from registry**

Replace the root-level logic in `getChildren`:

```typescript
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
    // [Review note 1] Must pass hookDoneMarkers as 5th arg to preserve Done status
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
        hookDoneMarkers  // [Review note 1] 5th arg — required for Done status
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

    // [Review note 1] Must include all 4 statuses — Done was missing
    const statusOrder = {
      [ClaudeSessionStatus.Active]: 0,
      [ClaudeSessionStatus.Waiting]: 1,
      [ClaudeSessionStatus.Done]: 2,
      [ClaudeSessionStatus.Inactive]: 3,
    };

    workspacesWithStatus.sort((a, b) => {
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.displayName.localeCompare(b.displayName);
    });

    return workspacesWithStatus;
  }
```

- [ ] **Step 3: Update `getProjectTreeItem` for new types**

Replace `getProjectTreeItem` to use `WorkspaceWithStatus`:

```typescript
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
```

- [ ] **Step 4: Update `getTreeItem` type guard**

```typescript
  getTreeItem(element: TreeNode): vscode.TreeItem {
    if (element.type === "session") {
      return this.getSessionTreeItem(element);
    }
    return this.getProjectTreeItem(element);
  }
```

- [ ] **Step 5: Update helper methods to use `WorkspaceWithStatus`**

Update `getStatusDescription` and `buildProjectTooltip`:

```typescript
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
      // [Review note 1] Done case was missing — must handle all 4 statuses
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
```

- [ ] **Step 6: Update `SessionItem` parent reference in `getSessionTreeItem`**

The `getSessionTreeItem` method references `element.parentProject` which is now `WorkspaceWithStatus`. The method itself doesn't access `.config.path` — it only uses `session` data — so no changes needed beyond the type.

> **Important:** The latest commit (`3f1db9b`) added a 3-state color system (`statusConfig` with Done/green) to `getSessionTreeItem` and `status-done.svg` to `getStatusIconFile`. These must be preserved — do NOT rewrite these methods, only update type references (`ProjectWithStatus` → `WorkspaceWithStatus`, `config.path` → `entry.folder`).

- [ ] **Step 7: Run existing tests and fix any type errors**

Run: `npx vitest run`
Expected: TypeScript compilation should succeed, tests pass.

- [ ] **Step 8: Add ProjectTreeProvider unit tests**

> [Review note 6] The plan deletes `projectManager.test.ts` but the rewritten tree provider logic is complex enough to warrant its own tests. Create `src/__tests__/projectTreeProvider.test.ts` with tests for:
> - `isCurrentWindow` labeling: current folder gets `"(this window)"` suffix, others don't
> - Status sorting: Active < Waiting < Done < Inactive, then alphabetical
> - `getStatusDescription` output for all 4 statuses (Active, Waiting, Done, Inactive)
> - Session count display (single vs multiple sessions)

- [ ] **Step 9: Commit**

```bash
git add src/projectTreeProvider.ts src/__tests__/projectTreeProvider.test.ts
git commit -m "feat: update ProjectTreeProvider to read from WorkspaceRegistry"
```

---

### Task 4: Rewire extension.ts — Registry Lifecycle and New Commands

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Replace ProjectManager with WorkspaceRegistry and update imports**

Replace the imports and initialization at the top of `activate()`:

```typescript
import * as vscode from "vscode";
import * as fsSync from "fs";  // [Review note 7] sync fs for deactivate()
import * as fs from "fs/promises";  // For mkdir before watcher setup
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { ClaudeProcessDetector } from "./claudeProcessDetector";
import { WorkspaceRegistry } from "./workspaceRegistry";
import { ProjectTreeProvider } from "./projectTreeProvider";
import { StatusBarManager } from "./statusBarManager";
import { HookManager } from "./hookManager";
import { CONFIG_SECTION, CPU_ACTIVE_THRESHOLD, CLAUDE_SESSIONS_DIR, HOOKS_POLLING_INTERVAL, VSCODE_WORKSPACES_DIR } from "./constants";
import { WorkspaceWithStatus } from "./types";
```

- [ ] **Step 2: Update `activate()` — initialization and registration**

Replace the component creation section:

```typescript
export function activate(context: vscode.ExtensionContext) {
  const cpuThreshold = vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>("cpuThreshold", CPU_ACTIVE_THRESHOLD);

  const detector = new ClaudeProcessDetector(cpuThreshold);
  const registry = new WorkspaceRegistry();
  const hookManager = new HookManager();
  const treeProvider = new ProjectTreeProvider(detector, registry, hookManager, context.extensionPath);
  const statusBar = new StatusBarManager(detector, hookManager);

  // Register current workspace in the shared registry
  const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const currentPid = process.pid;

  if (currentFolder) {
    registry.register(currentPid, currentFolder);
    treeProvider.setCurrentWindowFolder(currentFolder);
  }
```

- [ ] **Step 3: Add heartbeat to the polling cycle**

After the polling starts, add heartbeat logic. Insert this right before `treeProvider.startPolling()`:

```typescript
  // Heartbeat: update registry entry on each poll cycle
  if (currentFolder) {
    const heartbeatInterval = setInterval(() => {
      registry.heartbeat(currentPid, currentFolder);
    }, 10000); // Every 10 seconds
    context.subscriptions.push({ dispose: () => clearInterval(heartbeatInterval) });
  }
```

- [ ] **Step 4: Replace `addProject` command with `openNewProject`**

Replace the `claudeSessions.addProject` command registration:

```typescript
    vscode.commands.registerCommand("claudeSessions.addProject", async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "Open in VS Code",
      });
      if (uris && uris.length > 0) {
        const folderPath = uris[0].fsPath;
        // [Review note 5] Use VS Code API as primary path — avoids shell injection
        // The new VS Code window's extension instance will auto-register in the workspace registry
        const uri = vscode.Uri.file(folderPath);
        vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
      }
    }),
```

- [ ] **Step 5: Remove obsolete commands**

Remove these command registrations entirely:
- `claudeSessions.removeProject`
- `claudeSessions.autoDetectProjects`
- `claudeSessions.renameProject`

Keep these commands as-is (but update `ProjectWithStatus` → `WorkspaceWithStatus`):
- `claudeSessions.refreshProjects`
- `claudeSessions.openProject` — update to use `item.entry.folder` instead of `item.config.path`
- `claudeSessions.openProjectNewWindow` — update to use `item.entry.folder`
- `claudeSessions.openTerminal` — update to use `item.entry.folder` and `item.displayName`
- `claudeSessions.installHooks` / `claudeSessions.uninstallHooks` — keep as-is

Update the commands that reference the old type. For `openProject`:

```typescript
    vscode.commands.registerCommand("claudeSessions.openProject", async (item: WorkspaceWithStatus) => {
      if (item?.entry?.folder) {
        const currentFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (currentFolder === item.entry.folder) {
          vscode.window.showInformationMessage(`Already in ${item.displayName}`);
          return;
        }
        await switchToProject(item.entry.folder);
      }
    }),
```

For `openProjectNewWindow`:

```typescript
    vscode.commands.registerCommand("claudeSessions.openProjectNewWindow", (item: WorkspaceWithStatus) => {
      if (item?.entry?.folder) {
        const uri = vscode.Uri.file(item.entry.folder);
        vscode.commands.executeCommand("vscode.openFolder", uri, { forceNewWindow: true });
      }
    }),
```

For `openTerminal`:

```typescript
    vscode.commands.registerCommand("claudeSessions.openTerminal", (item: WorkspaceWithStatus) => {
      if (item?.entry?.folder) {
        const terminal = vscode.window.createTerminal({
          name: item.displayName,
          cwd: item.entry.folder,
        });
        terminal.show();
      }
    }),
```

- [ ] **Step 6: Add file watcher for the registry directory**

Add a new file watcher alongside the existing sessions watcher:

```typescript
  // [Review note 4] Ensure directory exists before creating watcher — on fresh install
  // the directory doesn't exist yet and the watcher would silently watch nothing
  await fs.mkdir(VSCODE_WORKSPACES_DIR, { recursive: true });

  // Watch ~/.claude/vscode-workspaces/ for changes so all windows sync immediately
  const registryPattern = new vscode.RelativePattern(
    vscode.Uri.file(VSCODE_WORKSPACES_DIR),
    "**"
  );
  const registryWatcher = vscode.workspace.createFileSystemWatcher(registryPattern);
  let registryDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  const debouncedRegistryRefresh = () => {
    if (registryDebounceTimer) clearTimeout(registryDebounceTimer);
    registryDebounceTimer = setTimeout(() => {
      treeProvider.refresh();
      updateBadge();
    }, 300);
  };
  registryWatcher.onDidCreate(debouncedRegistryRefresh);
  registryWatcher.onDidDelete(debouncedRegistryRefresh);
  registryWatcher.onDidChange(debouncedRegistryRefresh);
  context.subscriptions.push(registryWatcher, {
    dispose: () => { if (registryDebounceTimer) clearTimeout(registryDebounceTimer); }
  });
```

- [ ] **Step 7: Unregister on deactivate**

Update the `deactivate` function:

```typescript
// [Review note 7] Use ES imports at module top level, not require() inside deactivate:
import * as fsSync from "fs";
// ... (add near other imports at top of extension.ts)

export function deactivate() {
  // Best-effort cleanup of our registration file
  const currentPid = process.pid;
  // [Review note 7] Use the VSCODE_WORKSPACES_DIR constant, not a hardcoded path
  try {
    fsSync.unlinkSync(path.join(VSCODE_WORKSPACES_DIR, `${currentPid}.json`));
  } catch {
    // Best effort — stale entries get cleaned up by other instances
  }
}
```

Note: `deactivate` must be synchronous (or return a Promise within a short timeout). We use `unlinkSync` for reliability. The `fsSync` import and `VSCODE_WORKSPACES_DIR` constant are resolved at module load time, so they're available synchronously.

- [ ] **Step 8: Remove the `import { ProjectManager }` line and all references**

Make sure the `ProjectManager` import is removed and no references to it remain.

- [ ] **Step 9: Run the build to check for TypeScript errors**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/extension.ts
git commit -m "feat: wire WorkspaceRegistry lifecycle, replace manual project commands"
```

---

### Task 5: Update package.json — Commands, Menus, and Config

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update commands**

Remove these commands from `contributes.commands`:
- `claudeSessions.removeProject`
- `claudeSessions.autoDetectProjects`
- `claudeSessions.renameProject`

Update `claudeSessions.addProject`:

```json
{
  "command": "claudeSessions.addProject",
  "title": "Open New Project",
  "icon": "$(add)"
}
```

Keep all other commands unchanged.

- [ ] **Step 2: Update menus**

Replace the `view/title` section:

```json
"view/title": [
  {
    "command": "claudeSessions.addProject",
    "when": "view == claudeSessionsProjects",
    "group": "navigation@1"
  },
  {
    "command": "claudeSessions.refreshProjects",
    "when": "view == claudeSessionsProjects",
    "group": "navigation@2"
  }
]
```

Replace the `view/item/context` section — remove `removeProject` and `renameProject`:

```json
"view/item/context": [
  {
    "command": "claudeSessions.openProjectNewWindow",
    "when": "view == claudeSessionsProjects && viewItem == project",
    "group": "inline@1"
  },
  {
    "command": "claudeSessions.openTerminal",
    "when": "view == claudeSessionsProjects && viewItem == project",
    "group": "inline@2"
  }
]
```

- [ ] **Step 3: Update viewsWelcome**

Replace the welcome content:

```json
"viewsWelcome": [
  {
    "view": "claudeSessionsProjects",
    "contents": "No VS Code windows detected.\n[Open a Project](command:claudeSessions.addProject)"
  }
]
```

- [ ] **Step 4: Remove `claudeSessions.projects` from configuration**

Remove the `claudeSessions.projects` property from `contributes.configuration.properties`. Keep `pollingInterval`, `cpuThreshold`, and `showStatusBar`.

- [ ] **Step 5: Run the build to verify package.json is valid**

Run: `node esbuild.mjs`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "feat: update package.json — remove manual project commands, add open-new-project"
```

---

### Task 6: Delete ProjectManager and Update Tests

**Files:**
- Delete: `src/projectManager.ts`
- Delete: `src/__tests__/projectManager.test.ts`
- Modify: `src/__tests__/__mocks__/vscode.ts`

- [ ] **Step 1: Delete `src/projectManager.ts`**

```bash
rm src/projectManager.ts
```

- [ ] **Step 2: Delete `src/__tests__/projectManager.test.ts`**

```bash
rm src/__tests__/projectManager.test.ts
```

- [ ] **Step 3: Update `src/__tests__/__mocks__/vscode.ts`**

Remove `projects: []` from the config store since it's no longer used:

```typescript
const configStore: Record<string, Record<string, unknown>> = {
  claudeSessions: {
    pollingInterval: 3000,
    cpuThreshold: 5.0,
    showStatusBar: true,
  },
};
```

Update `_resetConfigStore` similarly:

```typescript
export function _resetConfigStore(): void {
  configStore.claudeSessions = {
    pollingInterval: 3000,
    cpuThreshold: 5.0,
    showStatusBar: true,
  };
}
```

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Run the full build**

Run: `node esbuild.mjs`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove ProjectManager — replaced by WorkspaceRegistry auto-discovery"
```

---

### Task 7: Ensure Registry Directory is Created at Startup

**Files:**
- Modify: `src/workspaceRegistry.ts`

- [ ] **Step 1: Verify `register()` creates the directory**

The `register()` method already calls `fs.mkdir(VSCODE_WORKSPACES_DIR, { recursive: true })` before writing. But `getActiveWorkspaces()` will fail silently if the directory doesn't exist (returns `[]`). This is the correct behavior — if no instance has registered yet, the directory doesn't exist and there are no workspaces to show.

No changes needed — verify this is already handled.

- [ ] **Step 2: Test edge case — first-ever activation**

Run the extension in the Extension Development Host:
1. Delete `~/.claude/vscode-workspaces/` if it exists
2. Open a folder in VS Code
3. Check the sidebar — should show the current workspace
4. Open another folder in a new window
5. Check both sidebars — both should show both workspaces
6. Close one window — the other should stop showing it within ~10 seconds

- [ ] **Step 3: Commit (if any fixes needed)**

```bash
git add src/workspaceRegistry.ts
git commit -m "fix: ensure registry directory edge cases are handled"
```

---

### Task 8: Final Integration Verification

**Files:** None (testing only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run build**

Run: `node esbuild.mjs`
Expected: Build succeeds.

- [ ] **Step 4: Manual smoke test in Extension Development Host**

Test these scenarios:
1. Open folder → appears in sidebar automatically
2. Click `+` → folder picker → select folder → new VS Code window opens with that folder
3. New window's folder appears in the first window's sidebar
4. Close the new window → it disappears from sidebar within ~10s
5. Claude session in a workspace → shows Active/Waiting/Inactive status correctly
6. Click a project in the tree → switches to that window
7. "Open in New Window" context menu → opens new window
8. "Open Terminal Here" context menu → opens terminal in project dir
9. Status bar shows correct session counts

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: auto-discover active VS Code windows — no manual project management"
```
