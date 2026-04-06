import { describe, it, expect, beforeEach, vi } from "vitest";
import * as vscode from "vscode";
import { ProjectTreeProvider } from "../projectTreeProvider";
import { ClaudeSessionStatus, WorkspaceWithStatus, WorkspaceEntry } from "../types";

// Create mock dependencies
function createMockDetector() {
  return {
    detectSessions: vi.fn().mockResolvedValue([]),
    getStatusForProject: vi.fn().mockReturnValue({
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
    getDoneMarkers: vi.fn().mockResolvedValue(new Set()),
    cleanStaleMarkers: vi.fn(),
  };
}

function makeEntry(overrides: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    pid: 12345,
    folder: "/Users/test/project",
    name: "project",
    lastSeen: Date.now(),
    ...overrides,
  };
}

describe("ProjectTreeProvider", () => {
  let provider: ProjectTreeProvider;
  let mockDetector: ReturnType<typeof createMockDetector>;
  let mockRegistry: ReturnType<typeof createMockRegistry>;
  let mockHookManager: ReturnType<typeof createMockHookManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDetector = createMockDetector();
    mockRegistry = createMockRegistry();
    mockHookManager = createMockHookManager();
    provider = new ProjectTreeProvider(
      mockDetector as never,
      mockRegistry as never,
      mockHookManager as never,
      "/ext/path"
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
      mockDetector.getStatusForProject.mockReturnValue({
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

    it("sorts by status order: Active < Waiting < Done < Inactive", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ pid: 1, folder: "/inactive", name: "d-inactive" }),
        makeEntry({ pid: 2, folder: "/active", name: "b-active" }),
        makeEntry({ pid: 3, folder: "/waiting", name: "c-waiting" }),
        makeEntry({ pid: 4, folder: "/done", name: "a-done" }),
      ]);

      mockDetector.getStatusForProject.mockImplementation((folder: string) => {
        if (folder === "/active") return { status: ClaudeSessionStatus.Active, sessions: [{ pid: 2 }] };
        if (folder === "/waiting") return { status: ClaudeSessionStatus.Waiting, sessions: [{ pid: 3 }] };
        if (folder === "/done") return { status: ClaudeSessionStatus.Done, sessions: [{ pid: 4 }] };
        return { status: ClaudeSessionStatus.Inactive, sessions: [] };
      });

      const children = await provider.getChildren();
      const names = children.map((c) => (c as WorkspaceWithStatus).displayName);
      expect(names).toEqual(["b-active", "c-waiting", "a-done", "d-inactive"]);
    });

    it("sorts alphabetically within the same status", async () => {
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ pid: 1, folder: "/zeta", name: "zeta" }),
        makeEntry({ pid: 2, folder: "/alpha", name: "alpha" }),
      ]);
      mockDetector.getStatusForProject.mockReturnValue({
        status: ClaudeSessionStatus.Inactive,
        sessions: [],
      });

      const children = await provider.getChildren();
      const names = children.map((c) => (c as WorkspaceWithStatus).displayName);
      expect(names).toEqual(["alpha", "zeta"]);
    });
  });

  describe("isCurrentWindow labeling", () => {
    it("labels current window with '(this window)' suffix", async () => {
      provider.setCurrentWindowFolder("/Users/test/my-project");
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/Users/test/my-project", name: "my-project" }),
      ]);

      const children = await provider.getChildren();
      const item = provider.getTreeItem(children[0]);
      expect((item as vscode.TreeItem).label).toBe("my-project (this window)");
    });

    it("does not label non-current windows", async () => {
      provider.setCurrentWindowFolder("/Users/test/other-project");
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/Users/test/my-project", name: "my-project" }),
      ]);

      const children = await provider.getChildren();
      const item = provider.getTreeItem(children[0]);
      expect((item as vscode.TreeItem).label).toBe("my-project");
    });

    it("does not set click command on current window item", async () => {
      provider.setCurrentWindowFolder("/Users/test/my-project");
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/Users/test/my-project", name: "my-project" }),
      ]);

      const children = await provider.getChildren();
      const item = provider.getTreeItem(children[0]);
      expect((item as vscode.TreeItem).command).toBeUndefined();
    });

    it("sets click command on non-current window items", async () => {
      provider.setCurrentWindowFolder("/Users/test/other");
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
      mockDetector.getStatusForProject.mockReturnValue({ status, sessions });
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

    it("shows 'Done' for Done status", async () => {
      const desc = await getDescription(ClaudeSessionStatus.Done, 1);
      expect(desc).toBe("Done");
    });

    it("shows 'No session' for Inactive status", async () => {
      const desc = await getDescription(ClaudeSessionStatus.Inactive, 0);
      expect(desc).toBe("No session");
    });
  });

  describe("getChildren — session children", () => {
    it("returns sessions as children of a project", async () => {
      const session = { pid: 1, sessionId: "s1", cwd: "/test", startedAt: Date.now(), kind: "cli", cpuPercent: 50 };
      mockRegistry.getActiveWorkspaces.mockResolvedValue([
        makeEntry({ folder: "/test", name: "test" }),
      ]);
      mockDetector.getStatusForProject.mockReturnValue({
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
      mockDetector.getStatusForProject.mockReturnValue({
        status: ClaudeSessionStatus.Active,
        sessions: [session],
      });

      const roots = await provider.getChildren();
      const sessions = await provider.getChildren(roots[0]);
      const leaf = await provider.getChildren(sessions[0]);
      expect(leaf).toEqual([]);
    });
  });
});
