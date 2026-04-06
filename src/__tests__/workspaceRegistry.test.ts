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

  afterEach(() => {
    vi.restoreAllMocks();
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
      vi.spyOn(process, "kill").mockImplementation(() => {
        throw new Error("ESRCH");
      });

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
