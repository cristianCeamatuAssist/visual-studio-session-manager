import { describe, it, expect, beforeEach, vi } from "vitest";
import { _resetConfigStore } from "./__mocks__/vscode";

// Mock fs/promises before importing ProjectManager
vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn(),
}));

import * as fs from "fs/promises";
import { ProjectManager } from "../projectManager";

const mockedReaddir = vi.mocked(fs.readdir);
const mockedReadFile = vi.mocked(fs.readFile);
const mockedAccess = vi.mocked(fs.access);

describe("ProjectManager", () => {
  let manager: ProjectManager;

  beforeEach(() => {
    _resetConfigStore();
    vi.clearAllMocks();
    manager = new ProjectManager();
  });

  describe("getProjects", () => {
    it("returns empty array when no projects configured", () => {
      expect(manager.getProjects()).toEqual([]);
    });
  });

  describe("addProject", () => {
    it("adds a project with normalized path", async () => {
      await manager.addProject("/Users/test/my-project/");
      const projects = manager.getProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].path).toBe("/Users/test/my-project");
    });

    it("adds a project with a custom name", async () => {
      await manager.addProject("/Users/test/my-project", "My Project");
      const projects = manager.getProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].name).toBe("My Project");
    });

    it("does not add duplicate projects", async () => {
      await manager.addProject("/Users/test/my-project");
      await manager.addProject("/Users/test/my-project/");
      const projects = manager.getProjects();
      expect(projects).toHaveLength(1);
    });

    it("adds a project without name when name is not provided", async () => {
      await manager.addProject("/Users/test/my-project");
      const projects = manager.getProjects();
      expect(projects[0].name).toBeUndefined();
    });
  });

  describe("removeProject", () => {
    it("removes a project by path", async () => {
      await manager.addProject("/Users/test/project-a");
      await manager.addProject("/Users/test/project-b");
      await manager.removeProject("/Users/test/project-a");
      const projects = manager.getProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].path).toBe("/Users/test/project-b");
    });

    it("handles trailing slash normalization on remove", async () => {
      await manager.addProject("/Users/test/my-project");
      await manager.removeProject("/Users/test/my-project/");
      expect(manager.getProjects()).toHaveLength(0);
    });

    it("does nothing when removing non-existent project", async () => {
      await manager.addProject("/Users/test/project-a");
      await manager.removeProject("/Users/test/non-existent");
      expect(manager.getProjects()).toHaveLength(1);
    });
  });

  describe("renameProject", () => {
    it("renames an existing project", async () => {
      await manager.addProject("/Users/test/my-project", "Old Name");
      await manager.renameProject("/Users/test/my-project", "New Name");
      expect(manager.getProjects()[0].name).toBe("New Name");
    });

    it("clears name when empty string is provided", async () => {
      await manager.addProject("/Users/test/my-project", "Old Name");
      await manager.renameProject("/Users/test/my-project", "");
      expect(manager.getProjects()[0].name).toBeUndefined();
    });

    it("handles trailing slash normalization on rename", async () => {
      await manager.addProject("/Users/test/my-project");
      await manager.renameProject("/Users/test/my-project/", "Renamed");
      expect(manager.getProjects()[0].name).toBe("Renamed");
    });

    it("does nothing when renaming non-existent project", async () => {
      await manager.addProject("/Users/test/my-project", "Original");
      await manager.renameProject("/Users/test/non-existent", "New Name");
      expect(manager.getProjects()[0].name).toBe("Original");
    });
  });

  describe("autoDetectProjects", () => {
    it("detects projects from session files", async () => {
      mockedReaddir.mockImplementation(async (dirPath) => {
        const dir = dirPath.toString();
        if (dir.includes("sessions")) {
          return ["session1.json", "session2.json"] as unknown as ReturnType<typeof fs.readdir>;
        }
        throw new Error("ENOENT");
      });

      mockedReadFile.mockImplementation(async (filePath) => {
        const fp = filePath.toString();
        if (fp.includes("session1.json")) {
          return JSON.stringify({ cwd: "/Users/test/project-a", pid: 123, sessionId: "abc" });
        }
        if (fp.includes("session2.json")) {
          return JSON.stringify({ cwd: "/Users/test/project-b", pid: 456, sessionId: "def" });
        }
        throw new Error("ENOENT");
      });

      const detected = await manager.autoDetectProjects();
      expect(detected).toHaveLength(2);
      expect(detected.map((p) => p.path)).toContain("/Users/test/project-a");
      expect(detected.map((p) => p.path)).toContain("/Users/test/project-b");
    });

    it("skips session files with invalid JSON", async () => {
      mockedReaddir.mockImplementation(async (dirPath) => {
        const dir = dirPath.toString();
        if (dir.includes("sessions")) {
          return ["valid.json", "corrupt.json"] as unknown as ReturnType<typeof fs.readdir>;
        }
        throw new Error("ENOENT");
      });

      mockedReadFile.mockImplementation(async (filePath) => {
        const fp = filePath.toString();
        if (fp.includes("valid.json")) {
          return JSON.stringify({ cwd: "/Users/test/project-a", pid: 123, sessionId: "abc" });
        }
        return "not valid json {{{";
      });

      const detected = await manager.autoDetectProjects();
      expect(detected).toHaveLength(1);
      expect(detected[0].path).toBe("/Users/test/project-a");
    });

    it("skips session files without cwd field", async () => {
      mockedReaddir.mockImplementation(async (dirPath) => {
        const dir = dirPath.toString();
        if (dir.includes("sessions")) {
          return ["no-cwd.json"] as unknown as ReturnType<typeof fs.readdir>;
        }
        throw new Error("ENOENT");
      });

      mockedReadFile.mockResolvedValue(JSON.stringify({ pid: 123, sessionId: "abc" }));

      const detected = await manager.autoDetectProjects();
      expect(detected).toHaveLength(0);
    });

    it("does not add projects that already exist", async () => {
      await manager.addProject("/Users/test/project-a");

      mockedReaddir.mockImplementation(async (dirPath) => {
        const dir = dirPath.toString();
        if (dir.includes("sessions")) {
          return ["session1.json"] as unknown as ReturnType<typeof fs.readdir>;
        }
        throw new Error("ENOENT");
      });

      mockedReadFile.mockResolvedValue(
        JSON.stringify({ cwd: "/Users/test/project-a", pid: 123, sessionId: "abc" })
      );

      const detected = await manager.autoDetectProjects();
      expect(detected).toHaveLength(0);
      expect(manager.getProjects()).toHaveLength(1);
    });

    it("detects projects from projects directory", async () => {
      mockedReaddir.mockImplementation(async (dirPath) => {
        const dir = dirPath.toString();
        if (dir.includes("sessions")) {
          return [] as unknown as ReturnType<typeof fs.readdir>;
        }
        if (dir.includes("projects")) {
          return ["-Users-test-my-project"] as unknown as ReturnType<typeof fs.readdir>;
        }
        throw new Error("ENOENT");
      });

      mockedAccess.mockResolvedValue(undefined);

      const detected = await manager.autoDetectProjects();
      expect(detected).toHaveLength(1);
    });

    it("returns empty when no sessions directory exists", async () => {
      mockedReaddir.mockRejectedValue(new Error("ENOENT"));
      const detected = await manager.autoDetectProjects();
      expect(detected).toHaveLength(0);
    });
  });
});
