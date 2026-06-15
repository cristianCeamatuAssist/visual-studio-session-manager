import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import { createMockMemento, DataTransfer, DataTransferItem, CancellationTokenSource } from "./__mocks__/vscode";
import { ProjectTreeProvider } from "../projectTreeProvider";
import { ClaudeSessionStatus, WorkspaceWithStatus, WorkspaceEntry } from "../types";

// Create mock dependencies
function createMockDetector() {
  return {
    detectSessions: vi.fn().mockResolvedValue([]),
    getStatusForWorkspace: vi.fn().mockReturnValue({
      status: ClaudeSessionStatus.Inactive,
      sessions: [],
    }),
  };
}

function createMockRegistry() {
  return {
    getActiveWorkspaces: vi.fn().mockResolvedValue([]),
    register: vi.fn().mockResolvedValue(undefined),
    unregister: vi.fn().mockResolvedValue(undefined),
    heartbeat: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockHookManager() {
  return {
    getWaitingMarkers: vi.fn().mockResolvedValue(new Set()),
    cleanStaleMarkers: vi.fn(),
  };
}

function makeEntry(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  const folder = overrides.folder ?? "/Users/test/project";
  return {
    pid: 12345,
    folder,
    folders: [folder],
    name: "project",
    kind: "folder",
    lastSeen: Date.now(),
    ...overrides,
  };
}

function createMockWorktreeResolver() {
  return vi.fn().mockResolvedValue({ isWorktree: false });
}

function createMockReadMetadata() {
  return vi.fn().mockResolvedValue(undefined);
}

function createMockGetBranch() {
  return vi.fn().mockResolvedValue(undefined);
}

describe("ProjectTreeProvider", () => {
  let provider: ProjectTreeProvider;
  let mockDetector: ReturnType<typeof createMockDetector>;
  let mockRegistry: ReturnType<typeof createMockRegistry>;
  let mockHookManager: ReturnType<typeof createMockHookManager>;
  let mockGlobalState: ReturnType<typeof createMockMemento>;
  let mockResolveWorktree: ReturnType<typeof createMockWorktreeResolver>;
  let mockReadMetadata: ReturnType<typeof createMockReadMetadata>;
  let mockGetBranch: ReturnType<typeof createMockGetBranch>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDetector = createMockDetector();
    mockRegistry = createMockRegistry();
    mockHookManager = createMockHookManager();
    mockGlobalState = createMockMemento();
    mockResolveWorktree = createMockWorktreeResolver();
    mockReadMetadata = createMockReadMetadata();
    mockGetBranch = createMockGetBranch();
    provider = new ProjectTreeProvider(
      mockDetector as never,
      mockRegistry as never,
      mockHookManager as never,
      "/ext/path",
      mockGlobalState as never,
      mockResolveWorktree,
      mockReadMetadata,
      mockGetBranch
    );
  });

  describe("getChildren — root level", () => {
    it("returns empty array when no workspaces registered", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([]);
      const children = await provider.getChildren();
      expect(children).toEqual([]);
    });

    it("returns workspaces with status from registry", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/Users/test/alpha", name: "alpha" }),
      ]);
      mockDetector.getStatusForWorkspace.mockReturnValue({
        status: ClaudeSessionStatus.Active,
        sessions: [{ pid: 1, sessionId: "s1", cwd: "/Users/test/alpha", startedAt: Date.now(), kind: "cli", cpuPercent: 50 }],
      });

      const children = await provider.getChildren();
      expect(children).toHaveLength(1);
      expect(children[0].type).toBe("project");
      const proj = children[0] as WorkspaceWithStatus;
      expect(proj.displayName).toBe("alpha");
      expect(proj.status).toBe(ClaudeSessionStatus.Active);
      expect(proj.sessionCount).toBe(1);
    });

    it("returns projects in saved order", async () => {
      mockGlobalState.update("projectOrder", ["/active", "/other", "/waiting", "/inactive"]);
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ pid: 1, folder: "/inactive", name: "d-inactive" }),
        makeEntry({ pid: 2, folder: "/active", name: "b-active" }),
        makeEntry({ pid: 3, folder: "/waiting", name: "c-waiting" }),
        makeEntry({ pid: 4, folder: "/other", name: "a-other" }),
      ]);

      mockDetector.getStatusForWorkspace.mockImplementation((folders: string[]) => {
        const folder = folders[0];
        if (folder === "/active") return { status: ClaudeSessionStatus.Active, sessions: [{ pid: 2 }] };
        if (folder === "/waiting") return { status: ClaudeSessionStatus.Waiting, sessions: [{ pid: 3 }] };
        if (folder === "/other") return { status: ClaudeSessionStatus.Active, sessions: [{ pid: 4 }] };
        return { status: ClaudeSessionStatus.Inactive, sessions: [] };
      });

      const children = await provider.getChildren();
      const names = children.map((c) => (c as WorkspaceWithStatus).displayName);
      expect(names).toEqual(["b-active", "a-other", "c-waiting", "d-inactive"]);
    });

    it("appends new projects at the bottom", async () => {
      mockGlobalState.update("projectOrder", ["/alpha"]);
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ pid: 1, folder: "/alpha", name: "alpha" }),
        makeEntry({ pid: 2, folder: "/zeta", name: "zeta" }),
      ]);
      mockDetector.getStatusForWorkspace.mockReturnValue({
        status: ClaudeSessionStatus.Inactive,
        sessions: [],
      });

      const children = await provider.getChildren();
      const names = children.map((c) => (c as WorkspaceWithStatus).displayName);
      expect(names).toEqual(["alpha", "zeta"]);
    });

    it("prunes stale entries from saved order", async () => {
      mockGlobalState.update("projectOrder", ["/removed", "/alpha", "/zeta"]);
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ pid: 1, folder: "/alpha", name: "alpha" }),
        makeEntry({ pid: 2, folder: "/zeta", name: "zeta" }),
      ]);
      mockDetector.getStatusForWorkspace.mockReturnValue({
        status: ClaudeSessionStatus.Inactive,
        sessions: [],
      });

      const children = await provider.getChildren();
      const names = children.map((c) => (c as WorkspaceWithStatus).displayName);
      expect(names).toEqual(["alpha", "zeta"]);
      // Saved order should be cleaned
      expect(mockGlobalState.get("projectOrder")).toEqual(["/alpha", "/zeta"]);
    });


    it("passes every workspace folder to the Claude detector", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({
          folder: "/Users/test/frontend",
          folders: ["/Users/test/frontend", "/Users/test/backend", "/Users/test/mobile"],
          name: "Frontend Backend Mobile projects",
          kind: "workspace",
          workspaceFile: "/Users/test/app.code-workspace",
        }),
      ]);

      await provider.getChildren();

      expect(mockDetector.getStatusForWorkspace).toHaveBeenCalledWith(
        ["/Users/test/frontend", "/Users/test/backend", "/Users/test/mobile"],
        expect.any(Array),
        expect.any(Set),
        false
      );
    });

    it("labels current multi-root workspace by workspace file key", async () => {
      provider.setCurrentWindowKey("/Users/test/app.code-workspace");
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({
          folder: "/Users/test/frontend",
          folders: ["/Users/test/frontend", "/Users/test/backend"],
          name: "Frontend Backend",
          kind: "workspace",
          workspaceFile: "/Users/test/app.code-workspace",
        }),
      ]);

      const children = await provider.getChildren();
      const item = provider.getTreeItem(children[0]);

      expect((item as vscode.TreeItem).label).toBe("Frontend Backend (this window)");
    });

  });

  describe("isCurrentWindow labeling", () => {
    it("labels current window with '(this window)' suffix", async () => {
      provider.setCurrentWindowKey("/Users/test/my-project");
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/Users/test/my-project", name: "my-project" }),
      ]);

      const children = await provider.getChildren();
      const item = provider.getTreeItem(children[0]);
      expect((item as vscode.TreeItem).label).toBe("my-project (this window)");
    });

    it("does not label non-current windows", async () => {
      provider.setCurrentWindowKey("/Users/test/other-project");
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/Users/test/my-project", name: "my-project" }),
      ]);

      const children = await provider.getChildren();
      const item = provider.getTreeItem(children[0]);
      expect((item as vscode.TreeItem).label).toBe("my-project");
    });

    it("does not set click command on current window item", async () => {
      provider.setCurrentWindowKey("/Users/test/my-project");
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/Users/test/my-project", name: "my-project" }),
      ]);

      const children = await provider.getChildren();
      const item = provider.getTreeItem(children[0]);
      expect((item as vscode.TreeItem).command).toBeUndefined();
    });

    it("sets click command on non-current window items", async () => {
      provider.setCurrentWindowKey("/Users/test/other");
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/Users/test/my-project", name: "my-project" }),
      ]);

      const children = await provider.getChildren();
      const item = provider.getTreeItem(children[0]);
      expect((item as vscode.TreeItem).command?.command).toBe("claudeSessions.openProject");
    });
  });

  describe("getStatusDescription", () => {
    async function getDescription(status: ClaudeSessionStatus, sessionCount: number, hooksInstalled = true): Promise<string> {
      const sessions = Array.from({ length: sessionCount }, (_, i) => ({
        pid: i + 1,
        sessionId: `s${i}`,
        cwd: "/test",
        startedAt: Date.now(),
        kind: "cli",
        cpuPercent: 50,
      }));
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/test", name: "test" }),
      ]);
      mockDetector.getStatusForWorkspace.mockReturnValue({ status, sessions });
      provider.setHooksInstalled(hooksInstalled);

      const children = await provider.getChildren();
      const item = provider.getTreeItem(children[0]);
      return (item as vscode.TreeItem).description as string;
    }

    it("shows 'Working' for Active status with hooks", async () => {
      const desc = await getDescription(ClaudeSessionStatus.Active, 1);
      expect(desc).toBe("Working");
    });

    it("shows session count for Active with multiple sessions", async () => {
      const desc = await getDescription(ClaudeSessionStatus.Active, 3);
      expect(desc).toBe("Working (3 sessions)");
    });

    it("shows CPU for Active without hooks", async () => {
      const desc = await getDescription(ClaudeSessionStatus.Active, 1, false);
      expect(desc).toMatch(/Working - CPU: \d+%/);
    });

    it("shows 'Needs input' for Waiting status", async () => {
      const desc = await getDescription(ClaudeSessionStatus.Waiting, 1);
      expect(desc).toBe("Needs input");
    });

    it("shows 'No session' for Inactive status", async () => {
      const desc = await getDescription(ClaudeSessionStatus.Inactive, 0);
      expect(desc).toBe("No session");
    });
  });

  describe("drag and drop", () => {
    const token = new CancellationTokenSource().token;

    async function setupProjects(folders: string[]): Promise<WorkspaceWithStatus[]> {
      const order = folders;
      mockGlobalState.update("projectOrder", order);
      mockRegistry.getActiveWorkspaces.mockResolvedValue(
        folders.map((f, i) => makeEntry({ pid: i + 1, folder: f, folders: [f], name: f.slice(1) }))
      );
      mockDetector.getStatusForWorkspace.mockReturnValue({
        status: ClaudeSessionStatus.Inactive,
        sessions: [],
      });
      const children = await provider.getChildren();
      return children as WorkspaceWithStatus[];
    }

    it("handleDrag sets project items in dataTransfer", async () => {
      const projects = await setupProjects(["/a", "/b"]);
      const dt = new DataTransfer();
      provider.handleDrag(projects, dt as never, token as never);
      const item = dt.get("application/vnd.code.tree.claudesessionsprojects");
      expect(item).toBeDefined();
      expect(item!.value).toEqual(projects);
    });

    it("handleDrag ignores session items", async () => {
      const projects = await setupProjects(["/a"]);
      const sessionChildren = await provider.getChildren(projects[0]);
      const dt = new DataTransfer();
      provider.handleDrag(sessionChildren, dt as never, token as never);
      const item = dt.get("application/vnd.code.tree.claudesessionsprojects");
      expect(item).toBeUndefined();
    });

    it("handleDrop moves project before target", async () => {
      const projects = await setupProjects(["/a", "/b", "/c"]);
      const dt = new DataTransfer();
      dt.set("application/vnd.code.tree.claudesessionsprojects", new DataTransferItem([projects[2]]));

      await provider.handleDrop(projects[0], dt as never, token as never);
      expect(mockGlobalState.get("projectOrder")).toEqual(["/c", "/a", "/b"]);
    });

    it("handleDrop appends to end when target is undefined", async () => {
      const projects = await setupProjects(["/a", "/b", "/c"]);
      const dt = new DataTransfer();
      dt.set("application/vnd.code.tree.claudesessionsprojects", new DataTransferItem([projects[0]]));

      await provider.handleDrop(undefined, dt as never, token as never);
      expect(mockGlobalState.get("projectOrder")).toEqual(["/b", "/c", "/a"]);
    });

    it("handleDrop preserves relative order of multiple dragged items", async () => {
      const projects = await setupProjects(["/a", "/b", "/c", "/d"]);
      const dt = new DataTransfer();
      dt.set("application/vnd.code.tree.claudesessionsprojects", new DataTransferItem([projects[0], projects[2]]));

      await provider.handleDrop(projects[3], dt as never, token as never);
      expect(mockGlobalState.get("projectOrder")).toEqual(["/b", "/a", "/c", "/d"]);
    });


    it("handleDrag ignores nested worktree projects", async () => {
      const worktree = {
        type: "project" as const,
        entry: makeEntry({ folder: "/a-wt", folders: ["/a-wt"], name: "a-wt" }),
        displayName: "a-wt",
        status: ClaudeSessionStatus.Inactive,
        sessions: [],
        sessionCount: 0,
        isCurrentWindow: false,
        worktreeOf: "/a",
        worktrees: [],
      };
      const dt = new DataTransfer();

      provider.handleDrag([worktree], dt as never, token as never);

      expect(dt.get("application/vnd.code.tree.claudesessionsprojects")).toBeUndefined();
    });

  });

  describe("getChildren — session children", () => {
    it("returns sessions as children of a project", async () => {
      const session = { pid: 1, sessionId: "s1", cwd: "/test", startedAt: Date.now(), kind: "cli", cpuPercent: 50 };
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/test", name: "test" }),
      ]);
      mockDetector.getStatusForWorkspace.mockReturnValue({
        status: ClaudeSessionStatus.Active,
        sessions: [session],
      });

      const roots = await provider.getChildren();
      const children = await provider.getChildren(roots[0]);
      expect(children).toHaveLength(1);
      expect(children[0].type).toBe("session");
    });

    it("returns empty array for session leaf nodes", async () => {
      const session = { pid: 1, sessionId: "s1", cwd: "/test", startedAt: Date.now(), kind: "cli", cpuPercent: 50 };
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/test", name: "test" }),
      ]);
      mockDetector.getStatusForWorkspace.mockReturnValue({
        status: ClaudeSessionStatus.Active,
        sessions: [session],
      });

      const roots = await provider.getChildren();
      const sessions = await provider.getChildren(roots[0]);
      const leaf = await provider.getChildren(sessions[0]);
      expect(leaf).toEqual([]);
    });


    it("wires session items to the focusSession command", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([makeEntry()]);
      mockDetector.getStatusForWorkspace.mockReturnValue({
        status: ClaudeSessionStatus.Active,
        sessions: [{ pid: 9, sessionId: "s9", cwd: "/Users/test/project", startedAt: Date.now(), kind: "cli", cpuPercent: 50 }],
      });

      const roots = await provider.getChildren();
      const children = await provider.getChildren(roots[0]);
      const item = provider.getTreeItem(children[0]);

      expect((item as vscode.TreeItem).command).toMatchObject({
        command: "claudeSessions.focusSession",
      });
    });

  });

  describe("worktree grouping", () => {
    it("nests a worktree window under its parent project", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ pid: 1, folder: "/Users/test/myrepo", folders: ["/Users/test/myrepo"], name: "myrepo" }),
        makeEntry({ pid: 2, folder: "/Users/test/myrepo-wt", folders: ["/Users/test/myrepo-wt"], name: "myrepo-wt" }),
      ]);
      mockResolveWorktree.mockImplementation(async (folder: string) =>
        folder === "/Users/test/myrepo-wt"
          ? { isWorktree: true, mainRepoRoot: "/Users/test/myrepo" }
          : { isWorktree: false }
      );

      const roots = await provider.getChildren();

      expect(roots).toHaveLength(1);
      const parent = roots[0] as WorkspaceWithStatus;
      expect(parent.displayName).toBe("myrepo");
      expect(parent.worktrees).toHaveLength(1);
      expect(parent.worktrees[0].displayName).toBe("myrepo-wt");
      expect(parent.worktrees[0].worktreeOf).toBe("/Users/test/myrepo");
    });



    it("nests a worktree under a parent workspace secondary folder", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({
          pid: 1,
          folder: "/Users/test/frontend",
          folders: ["/Users/test/frontend", "/Users/test/myrepo"],
          name: "App Workspace",
          kind: "workspace",
          workspaceFile: "/Users/test/app.code-workspace",
        }),
        makeEntry({ pid: 2, folder: "/Users/test/myrepo-wt", folders: ["/Users/test/myrepo-wt"], name: "myrepo-wt" }),
      ]);
      mockResolveWorktree.mockImplementation(async (folder: string) =>
        folder === "/Users/test/myrepo-wt"
          ? { isWorktree: true, mainRepoRoot: "/Users/test/myrepo" }
          : { isWorktree: false }
      );

      const roots = await provider.getChildren();

      expect(roots).toHaveLength(1);
      const parent = roots[0] as WorkspaceWithStatus;
      expect(parent.displayName).toBe("App Workspace");
      expect(parent.worktrees).toHaveLength(1);
      expect(parent.worktrees[0].displayName).toBe("myrepo-wt");
    });


    it("returns worktree projects as children after sessions", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ pid: 1, folder: "/Users/test/myrepo", folders: ["/Users/test/myrepo"], name: "myrepo" }),
        makeEntry({ pid: 2, folder: "/Users/test/myrepo-wt", folders: ["/Users/test/myrepo-wt"], name: "myrepo-wt" }),
      ]);
      mockDetector.getStatusForWorkspace.mockImplementation((folders: string[]) =>
        folders[0] === "/Users/test/myrepo"
          ? {
              status: ClaudeSessionStatus.Active,
              sessions: [{ pid: 9, sessionId: "s9", cwd: "/Users/test/myrepo", startedAt: Date.now(), kind: "cli", cpuPercent: 50 }],
            }
          : { status: ClaudeSessionStatus.Inactive, sessions: [] }
      );
      mockResolveWorktree.mockImplementation(async (folder: string) =>
        folder === "/Users/test/myrepo-wt"
          ? { isWorktree: true, mainRepoRoot: "/Users/test/myrepo" }
          : { isWorktree: false }
      );

      const roots = await provider.getChildren();
      const children = await provider.getChildren(roots[0]);

      expect(children.map((c) => c.type)).toEqual(["session", "project"]);
    });



    it("rolls active worktree status up to the parent row", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ pid: 1, folder: "/Users/test/myrepo", folders: ["/Users/test/myrepo"], name: "myrepo" }),
        makeEntry({ pid: 2, folder: "/Users/test/myrepo-wt", folders: ["/Users/test/myrepo-wt"], name: "myrepo-wt" }),
      ]);
      mockDetector.getStatusForWorkspace.mockImplementation((folders: string[]) =>
        folders[0] === "/Users/test/myrepo-wt"
          ? {
              status: ClaudeSessionStatus.Active,
              sessions: [{ pid: 9, sessionId: "s9", cwd: "/Users/test/myrepo-wt", startedAt: Date.now(), kind: "cli", cpuPercent: 50 }],
            }
          : { status: ClaudeSessionStatus.Inactive, sessions: [] }
      );
      mockResolveWorktree.mockImplementation(async (folder: string) =>
        folder === "/Users/test/myrepo-wt"
          ? { isWorktree: true, mainRepoRoot: "/Users/test/myrepo" }
          : { isWorktree: false }
      );

      const roots = await provider.getChildren();
      const parent = roots[0] as WorkspaceWithStatus;
      const item = provider.getTreeItem(parent);

      expect(parent.status).toBe(ClaudeSessionStatus.Active);
      expect(parent.sessionCount).toBe(1);
      expect((item as vscode.TreeItem).description).toBe("Working - CPU: 50%");
    });


    it("keeps a worktree at root level when its parent window is not open", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ pid: 2, folder: "/Users/test/myrepo-wt", folders: ["/Users/test/myrepo-wt"], name: "myrepo-wt" }),
      ]);
      mockResolveWorktree.mockResolvedValue({ isWorktree: true, mainRepoRoot: "/Users/test/myrepo" });

      const roots = await provider.getChildren();

      expect(roots).toHaveLength(1);
      expect((roots[0] as WorkspaceWithStatus).worktreeOf).toBe("/Users/test/myrepo");
    });

    it("marks worktree items in the tree item description", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ pid: 2, folder: "/Users/test/myrepo-wt", folders: ["/Users/test/myrepo-wt"], name: "myrepo-wt" }),
      ]);
      mockResolveWorktree.mockResolvedValue({ isWorktree: true, mainRepoRoot: "/Users/test/myrepo" });

      const roots = await provider.getChildren();
      const item = provider.getTreeItem(roots[0]);

      expect(String((item as vscode.TreeItem).description)).toContain("worktree");
    });
  });

  describe("session metadata rendering", () => {
    it("labels a session by its chat title and shows context %", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([makeEntry({ folder: "/p", name: "p" })]);
      const session = { pid: 7, sessionId: "abc", cwd: "/p", startedAt: Date.now(), kind: "cli", cpuPercent: 50 };
      mockDetector.detectSessions.mockResolvedValue([session]);
      mockDetector.getStatusForWorkspace.mockReturnValue({ status: ClaudeSessionStatus.Active, sessions: [session] });
      mockReadMetadata.mockResolvedValue({ title: "Fix voyager tests", contextPercent: 45, gitBranch: "feat/x" });

      const roots = await provider.getChildren();
      const children = await provider.getChildren(roots[0]);
      const sessionNode = children.find((c) => c.type === "session")!;
      const item = provider.getTreeItem(sessionNode);

      expect((item as vscode.TreeItem).label).toBe("Fix voyager tests");
      expect(String((item as vscode.TreeItem).description)).toContain("45% ·");
    });

    it("falls back to PID label when there is no title", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([makeEntry({ folder: "/p", name: "p" })]);
      const session = { pid: 7, sessionId: "abc", cwd: "/p", startedAt: Date.now(), kind: "cli", cpuPercent: 50 };
      mockDetector.detectSessions.mockResolvedValue([session]);
      mockDetector.getStatusForWorkspace.mockReturnValue({ status: ClaudeSessionStatus.Active, sessions: [session] });
      mockReadMetadata.mockResolvedValue(undefined);

      const roots = await provider.getChildren();
      const children = await provider.getChildren(roots[0]);
      const item = provider.getTreeItem(children.find((c) => c.type === "session")!);

      expect((item as vscode.TreeItem).label).toBe("PID 7");
    });

    it("shows the git branch on the project row from its sessions", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([makeEntry({ folder: "/p", name: "p" })]);
      const session = { pid: 7, sessionId: "abc", cwd: "/p", startedAt: Date.now(), kind: "cli", cpuPercent: 1 };
      mockDetector.detectSessions.mockResolvedValue([session]);
      mockDetector.getStatusForWorkspace.mockReturnValue({ status: ClaudeSessionStatus.Active, sessions: [session] });
      mockReadMetadata.mockResolvedValue({ gitBranch: "feat/voyager" });

      const roots = await provider.getChildren();
      const item = provider.getTreeItem(roots[0]);

      expect(String((item as vscode.TreeItem).description)).toContain("feat/voyager");
      expect(mockGetBranch).not.toHaveBeenCalled();
    });

    it("falls back to git for branch when the project has no sessions", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([makeEntry({ folder: "/idle", name: "idle" })]);
      mockDetector.detectSessions.mockResolvedValue([]);
      mockDetector.getStatusForWorkspace.mockReturnValue({ status: ClaudeSessionStatus.Inactive, sessions: [] });
      mockGetBranch.mockResolvedValue("main");

      const roots = await provider.getChildren();
      const item = provider.getTreeItem(roots[0]);

      expect(mockGetBranch).toHaveBeenCalledWith("/idle");
      expect(String((item as vscode.TreeItem).description)).toContain("main");
    });
  });
});
