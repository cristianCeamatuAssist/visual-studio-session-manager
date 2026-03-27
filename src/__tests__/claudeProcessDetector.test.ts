import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  access: vi.fn(),
}));

vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("util", async () => {
  const actual = await vi.importActual<typeof import("util")>("util");
  return {
    ...actual,
    promisify: (fn: Function) => {
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          fn(...args, (err: Error | null, stdout: string, stderr: string) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          });
        });
    },
  };
});

import * as fs from "fs/promises";
import { exec } from "child_process";
import { ClaudeProcessDetector } from "../claudeProcessDetector";
import { ClaudeSession, ClaudeSessionStatus } from "../types";

const mockedReaddir = vi.mocked(fs.readdir);
const mockedReadFile = vi.mocked(fs.readFile);
const mockedExec = vi.mocked(exec);

describe("ClaudeProcessDetector", () => {
  let detector: ClaudeProcessDetector;

  beforeEach(() => {
    vi.clearAllMocks();
    detector = new ClaudeProcessDetector(5.0);
  });

  describe("detectSessions", () => {
    it("returns empty array when sessions directory does not exist", async () => {
      mockedReaddir.mockRejectedValue(new Error("ENOENT"));
      const sessions = await detector.detectSessions();
      expect(sessions).toEqual([]);
    });

    it("returns empty array when no session files exist", async () => {
      mockedReaddir.mockResolvedValue([] as unknown as ReturnType<typeof fs.readdir>);
      const sessions = await detector.detectSessions();
      expect(sessions).toEqual([]);
    });

    it("parses valid session files and filters by running processes", async () => {
      mockedReaddir.mockResolvedValue(["s1.json", "s2.json"] as unknown as ReturnType<typeof fs.readdir>);

      mockedReadFile.mockImplementation(async (filePath) => {
        const fp = filePath.toString();
        if (fp.includes("s1.json")) {
          return JSON.stringify({
            pid: 1001,
            sessionId: "sess-aaa",
            cwd: "/Users/test/project-a",
            startedAt: Date.now() - 60000,
            kind: "cli",
          });
        }
        return JSON.stringify({
          pid: 1002,
          sessionId: "sess-bbb",
          cwd: "/Users/test/project-b",
          startedAt: Date.now() - 30000,
          kind: "cli",
        });
      });

      mockedExec.mockImplementation((_cmd, callback) => {
        (callback as Function)(null, "  PID  %CPU\n 1001  12.3\n", "");
        return {} as ReturnType<typeof exec>;
      });

      const sessions = await detector.detectSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].pid).toBe(1001);
      expect(sessions[0].cpuPercent).toBe(12.3);
    });

    it("skips session files with missing required fields", async () => {
      mockedReaddir.mockResolvedValue(["incomplete.json"] as unknown as ReturnType<typeof fs.readdir>);
      mockedReadFile.mockResolvedValue(JSON.stringify({ pid: 123 }));

      const sessions = await detector.detectSessions();
      expect(sessions).toEqual([]);
    });

    it("skips corrupt JSON files", async () => {
      mockedReaddir.mockResolvedValue(["bad.json", "good.json"] as unknown as ReturnType<typeof fs.readdir>);

      mockedReadFile.mockImplementation(async (filePath) => {
        const fp = filePath.toString();
        if (fp.includes("bad.json")) return "{{not json}}";
        return JSON.stringify({
          pid: 1001,
          sessionId: "sess-aaa",
          cwd: "/Users/test/project",
          startedAt: Date.now(),
          kind: "cli",
        });
      });

      mockedExec.mockImplementation((_cmd, callback) => {
        (callback as Function)(null, "  PID  %CPU\n 1001   0.5\n", "");
        return {} as ReturnType<typeof exec>;
      });

      const sessions = await detector.detectSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].pid).toBe(1001);
    });

    it("skips non-json files in sessions directory", async () => {
      mockedReaddir.mockResolvedValue(["readme.txt", "s1.json"] as unknown as ReturnType<typeof fs.readdir>);

      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          pid: 1001,
          sessionId: "sess-aaa",
          cwd: "/Users/test/project",
          startedAt: Date.now(),
          kind: "cli",
        })
      );

      mockedExec.mockImplementation((_cmd, callback) => {
        (callback as Function)(null, "  PID  %CPU\n 1001   1.0\n", "");
        return {} as ReturnType<typeof exec>;
      });

      const sessions = await detector.detectSessions();
      expect(sessions).toHaveLength(1);
    });
  });

  describe("getStatusForProject", () => {
    const makeSessions = (entries: Array<{ pid: number; cwd: string; cpu: number }>): ClaudeSession[] =>
      entries.map((e) => ({
        pid: e.pid,
        sessionId: `sess-${e.pid}`,
        cwd: e.cwd,
        startedAt: Date.now(),
        kind: "cli",
        cpuPercent: e.cpu,
      }));

    it("returns Inactive when no sessions match the project", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/other/path", cpu: 10 }]);
      const result = detector.getStatusForProject("/Users/test/project", sessions);
      expect(result.status).toBe(ClaudeSessionStatus.Inactive);
      expect(result.sessions).toHaveLength(0);
    });

    it("returns Active when a matching session has CPU above threshold", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project", cpu: 25.0 }]);
      const result = detector.getStatusForProject("/Users/test/project", sessions);
      expect(result.status).toBe(ClaudeSessionStatus.Active);
      expect(result.sessions).toHaveLength(1);
    });

    it("returns Waiting when all matching sessions have CPU below threshold", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project", cpu: 2.0 }]);
      const result = detector.getStatusForProject("/Users/test/project", sessions);
      expect(result.status).toBe(ClaudeSessionStatus.Waiting);
    });

    it("matches sessions in subdirectories of the project", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project/subdir", cpu: 10.0 }]);
      const result = detector.getStatusForProject("/Users/test/project", sessions);
      expect(result.status).toBe(ClaudeSessionStatus.Active);
      expect(result.sessions).toHaveLength(1);
    });

    it("does not match a project whose name is a prefix of another", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project-extended", cpu: 10.0 }]);
      const result = detector.getStatusForProject("/Users/test/project", sessions);
      expect(result.status).toBe(ClaudeSessionStatus.Inactive);
    });

    it("handles trailing slash normalization", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project/", cpu: 10.0 }]);
      const result = detector.getStatusForProject("/Users/test/project/", sessions);
      expect(result.status).toBe(ClaudeSessionStatus.Active);
    });

    it("sorts matching sessions by CPU descending", () => {
      const sessions = makeSessions([
        { pid: 1, cwd: "/Users/test/project", cpu: 2.0 },
        { pid: 2, cwd: "/Users/test/project", cpu: 30.0 },
        { pid: 3, cwd: "/Users/test/project", cpu: 15.0 },
      ]);
      const result = detector.getStatusForProject("/Users/test/project", sessions);
      expect(result.sessions[0].cpuPercent).toBe(30.0);
      expect(result.sessions[1].cpuPercent).toBe(15.0);
      expect(result.sessions[2].cpuPercent).toBe(2.0);
    });

    it("returns Active if at least one session exceeds threshold", () => {
      const sessions = makeSessions([
        { pid: 1, cwd: "/Users/test/project", cpu: 1.0 },
        { pid: 2, cwd: "/Users/test/project", cpu: 20.0 },
      ]);
      const result = detector.getStatusForProject("/Users/test/project", sessions);
      expect(result.status).toBe(ClaudeSessionStatus.Active);
    });
  });

  describe("setCpuThreshold", () => {
    it("changes the threshold used for active/waiting determination", () => {
      const sessions: ClaudeSession[] = [
        {
          pid: 1,
          sessionId: "s1",
          cwd: "/project",
          startedAt: Date.now(),
          kind: "cli",
          cpuPercent: 8.0,
        },
      ];

      expect(detector.getStatusForProject("/project", sessions).status).toBe(ClaudeSessionStatus.Active);

      detector.setCpuThreshold(10.0);
      expect(detector.getStatusForProject("/project", sessions).status).toBe(ClaudeSessionStatus.Waiting);
    });
  });

  describe("getActiveSessionCount", () => {
    it("returns total number of sessions", () => {
      const sessions: ClaudeSession[] = [
        { pid: 1, sessionId: "s1", cwd: "/a", startedAt: 0, kind: "cli", cpuPercent: 0 },
        { pid: 2, sessionId: "s2", cwd: "/b", startedAt: 0, kind: "cli", cpuPercent: 50 },
      ];
      expect(detector.getActiveSessionCount(sessions)).toBe(2);
    });
  });

  describe("getActiveCount", () => {
    it("returns count of sessions above CPU threshold", () => {
      const sessions: ClaudeSession[] = [
        { pid: 1, sessionId: "s1", cwd: "/a", startedAt: 0, kind: "cli", cpuPercent: 1.0 },
        { pid: 2, sessionId: "s2", cwd: "/b", startedAt: 0, kind: "cli", cpuPercent: 20.0 },
        { pid: 3, sessionId: "s3", cwd: "/c", startedAt: 0, kind: "cli", cpuPercent: 8.0 },
      ];
      expect(detector.getActiveCount(sessions)).toBe(2);
    });
  });
});
