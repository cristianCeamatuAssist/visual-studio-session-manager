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

      // First call: ps for session PIDs; second call: pgrep for children of PID 1001
      let callCount = 0;
      mockedExec.mockImplementation((_cmd, callback) => {
        const cmd = _cmd as string;
        if (cmd.includes("pgrep")) {
          // No child processes
          (callback as Function)(new Error("no children"), "", "");
        } else {
          // ps for main processes — only PID 1001 is alive
          (callback as Function)(null, "  PID  %CPU\n 1001  12.3\n", "");
        }
        return {} as ReturnType<typeof exec>;
      });

      const sessions = await detector.detectSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].pid).toBe(1001);
      expect(sessions[0].cpuPercent).toBe(12.3);
    });

    it("includes child process CPU in effective CPU", async () => {
      mockedReaddir.mockResolvedValue(["s1.json"] as unknown as ReturnType<typeof fs.readdir>);

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
        const cmd = _cmd as string;
        if (cmd.includes("pgrep -P 1001")) {
          // Child PIDs
          (callback as Function)(null, "2001\n2002\n", "");
        } else if (cmd.includes("ps -p 2001,2002")) {
          // Child CPU
          (callback as Function)(null, "  PID  %CPU\n 2001  15.0\n 2002  10.0\n", "");
        } else if (cmd.includes("ps -p 1001")) {
          // Parent has low CPU
          (callback as Function)(null, "  PID  %CPU\n 1001   2.0\n", "");
        } else {
          (callback as Function)(new Error("unknown cmd"), "", "");
        }
        return {} as ReturnType<typeof exec>;
      });

      const sessions = await detector.detectSessions();
      expect(sessions).toHaveLength(1);
      // Effective CPU = own (2.0) + children (15.0 + 10.0) = 27.0
      expect(sessions[0].cpuPercent).toBe(27.0);
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
        const cmd = _cmd as string;
        if (cmd.includes("pgrep")) {
          (callback as Function)(new Error("no children"), "", "");
        } else {
          (callback as Function)(null, "  PID  %CPU\n 1001   0.5\n", "");
        }
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
        const cmd = _cmd as string;
        if (cmd.includes("pgrep")) {
          (callback as Function)(new Error("no children"), "", "");
        } else {
          (callback as Function)(null, "  PID  %CPU\n 1001   1.0\n", "");
        }
        return {} as ReturnType<typeof exec>;
      });

      const sessions = await detector.detectSessions();
      expect(sessions).toHaveLength(1);
    });

    it("clears CPU history when no sessions exist", async () => {
      // First call: one session to populate history
      mockedReaddir.mockResolvedValue(["s1.json"] as unknown as ReturnType<typeof fs.readdir>);
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
        const cmd = _cmd as string;
        if (cmd.includes("pgrep")) {
          (callback as Function)(new Error("no children"), "", "");
        } else {
          (callback as Function)(null, "  PID  %CPU\n 1001  10.0\n", "");
        }
        return {} as ReturnType<typeof exec>;
      });
      await detector.detectSessions();
      expect(detector.getCpuHistory().size).toBe(1);

      // Second call: no sessions
      mockedReaddir.mockRejectedValue(new Error("ENOENT"));
      await detector.detectSessions();
      expect(detector.getCpuHistory().size).toBe(0);
    });
  });

  describe("detectSessions with hooksInstalled=true", () => {
    it("returns sessions without calling ps or pgrep", async () => {
      mockedReaddir.mockResolvedValue(["s1.json"] as unknown as ReturnType<typeof fs.readdir>);
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          pid: 1001,
          sessionId: "sess-aaa",
          cwd: "/Users/test/project",
          startedAt: Date.now(),
          kind: "cli",
        })
      );

      const sessions = await detector.detectSessions(true);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].pid).toBe(1001);
      expect(sessions[0].cpuPercent).toBe(-1);
      // exec (ps/pgrep) should NOT be called
      expect(mockedExec).not.toHaveBeenCalled();
    });

    it("still filters out sessions with missing fields", async () => {
      mockedReaddir.mockResolvedValue(["bad.json", "good.json"] as unknown as ReturnType<typeof fs.readdir>);
      mockedReadFile.mockImplementation(async (filePath) => {
        const fp = filePath.toString();
        if (fp.includes("bad.json")) return JSON.stringify({ pid: 123 });
        return JSON.stringify({
          pid: 1001,
          sessionId: "sess-aaa",
          cwd: "/Users/test/project",
          startedAt: Date.now(),
          kind: "cli",
        });
      });

      const sessions = await detector.detectSessions(true);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].pid).toBe(1001);
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

    it("returns Active during debounce period even when CPU is below threshold", () => {
      // No CPU history yet → should return Active (benefit of the doubt)
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project", cpu: 2.0 }]);
      const result = detector.getStatusForProject("/Users/test/project", sessions);
      expect(result.status).toBe(ClaudeSessionStatus.Active);
    });

    it("returns Waiting only after enough consecutive low-CPU readings", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project", cpu: 2.0 }]);

      // Simulate 3 consecutive low-CPU readings in history
      const history = detector.getCpuHistory();
      history.set(1, [2.0, 1.5, 3.0]);

      const result = detector.getStatusForProject("/Users/test/project", sessions);
      expect(result.status).toBe(ClaudeSessionStatus.Waiting);
    });

    it("returns Active if any reading in history was above threshold", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project", cpu: 2.0 }]);

      // One reading was high
      const history = detector.getCpuHistory();
      history.set(1, [2.0, 8.0, 2.0]);

      const result = detector.getStatusForProject("/Users/test/project", sessions);
      expect(result.status).toBe(ClaudeSessionStatus.Active);
    });

    it("uses hook markers as authoritative signal when available", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project", cpu: 2.0 }]);

      // Hook marker says this PID is waiting
      const hookMarkers = new Set(["1"]);
      const result = detector.getStatusForProject("/Users/test/project", sessions, hookMarkers);
      expect(result.status).toBe(ClaudeSessionStatus.Waiting);
    });

    it("does not match hook markers by session ID (only PID)", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project", cpu: 2.0 }]);

      // Session ID markers are no longer matched — only PID markers
      const hookMarkers = new Set(["sess-1"]);
      const result = detector.getStatusForProject("/Users/test/project", sessions, hookMarkers);
      expect(result.status).toBe(ClaudeSessionStatus.Active);
    });

    it("returns Active when hook markers exist but none match these sessions", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project", cpu: 2.0 }]);

      // Hook markers for other sessions only
      const hookMarkers = new Set(["999"]);
      const result = detector.getStatusForProject("/Users/test/project", sessions, hookMarkers);
      expect(result.status).toBe(ClaudeSessionStatus.Active);
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

    it("getStatusForWorkspace matches sessions under any workspace folder", () => {
      const sessions = makeSessions([
        { pid: 1, cwd: "/Users/test/frontend/app", cpu: 15.0 },
        { pid: 2, cwd: "/Users/test/backend", cpu: 30.0 },
        { pid: 3, cwd: "/Users/test/mobile", cpu: 40.0 },
      ]);

      const result = detector.getStatusForWorkspace(
        ["/Users/test/frontend", "/Users/test/backend"],
        sessions
      );

      expect(result.status).toBe(ClaudeSessionStatus.Active);
      expect(result.sessions.map((session) => session.pid)).toEqual([2, 1]);
    });

    it("getStatusForWorkspace does not match sibling prefixes", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/frontend-old", cpu: 10.0 }]);

      const result = detector.getStatusForWorkspace(["/Users/test/frontend"], sessions);

      expect(result.status).toBe(ClaudeSessionStatus.Inactive);
      expect(result.sessions).toHaveLength(0);
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

  describe("getStatusForProject with hooksInstalled=true", () => {
    const makeSessions = (entries: Array<{ pid: number; cwd: string }>): ClaudeSession[] =>
      entries.map((e) => ({
        pid: e.pid,
        sessionId: `sess-${e.pid}`,
        cwd: e.cwd,
        startedAt: Date.now(),
        kind: "cli",
        cpuPercent: -1,
      }));

    it("returns Active when sessions exist but no waiting markers", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project" }]);
      const hookMarkers = new Set<string>();
      const result = detector.getStatusForProject("/Users/test/project", sessions, hookMarkers, true);
      expect(result.status).toBe(ClaudeSessionStatus.Active);
    });

    it("returns Waiting when a matching session has a waiting marker by PID", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project" }]);
      const hookMarkers = new Set(["1"]);
      const result = detector.getStatusForProject("/Users/test/project", sessions, hookMarkers, true);
      expect(result.status).toBe(ClaudeSessionStatus.Waiting);
    });

    it("returns Waiting when marker matches PID", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project" }]);
      const hookMarkers = new Set(["1"]);
      const result = detector.getStatusForProject("/Users/test/project", sessions, hookMarkers, true);
      expect(result.status).toBe(ClaudeSessionStatus.Waiting);
    });

    it("returns Active when markers exist but none match these sessions", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project" }]);
      const hookMarkers = new Set(["999"]);
      const result = detector.getStatusForProject("/Users/test/project", sessions, hookMarkers, true);
      expect(result.status).toBe(ClaudeSessionStatus.Active);
    });

    it("returns Inactive when no sessions match project", () => {
      const sessions = makeSessions([{ pid: 1, cwd: "/other" }]);
      const hookMarkers = new Set<string>();
      const result = detector.getStatusForProject("/Users/test/project", sessions, hookMarkers, true);
      expect(result.status).toBe(ClaudeSessionStatus.Inactive);
    });

    it("ignores CPU values entirely — does not check threshold", () => {
      // Even with high CPU, if marker says waiting, it's waiting
      const sessions: ClaudeSession[] = [{
        pid: 1,
        sessionId: "sess-1",
        cwd: "/Users/test/project",
        startedAt: Date.now(),
        kind: "cli",
        cpuPercent: 50.0, // high CPU but hooks override
      }];
      const hookMarkers = new Set(["1"]);
      const result = detector.getStatusForProject("/Users/test/project", sessions, hookMarkers, true);
      expect(result.status).toBe(ClaudeSessionStatus.Waiting);
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

      // With debouncing, low CPU without history returns Active
      // Populate history to get Waiting
      detector.getCpuHistory().set(1, [8.0, 8.0, 8.0]);
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

  describe("debouncing", () => {
    it("tracks CPU history across multiple detectSessions calls", async () => {
      mockedReaddir.mockResolvedValue(["s1.json"] as unknown as ReturnType<typeof fs.readdir>);
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          pid: 1001,
          sessionId: "sess-aaa",
          cwd: "/Users/test/project",
          startedAt: Date.now(),
          kind: "cli",
        })
      );

      let cpuValue = 2.0;
      mockedExec.mockImplementation((_cmd, callback) => {
        const cmd = _cmd as string;
        if (cmd.includes("pgrep")) {
          (callback as Function)(new Error("no children"), "", "");
        } else {
          (callback as Function)(null, `  PID  %CPU\n 1001  ${cpuValue}\n`, "");
        }
        return {} as ReturnType<typeof exec>;
      });

      // Call 1
      await detector.detectSessions();
      expect(detector.getCpuHistory().get(1001)).toEqual([2.0]);

      // Call 2
      cpuValue = 3.0;
      await detector.detectSessions();
      expect(detector.getCpuHistory().get(1001)).toEqual([2.0, 3.0]);

      // Call 3
      cpuValue = 1.0;
      await detector.detectSessions();
      expect(detector.getCpuHistory().get(1001)).toEqual([2.0, 3.0, 1.0]);

      // Call 4 — oldest entry should be evicted
      cpuValue = 4.0;
      await detector.detectSessions();
      expect(detector.getCpuHistory().get(1001)).toEqual([3.0, 1.0, 4.0]);
    });

    it("cleans up history for dead PIDs", async () => {
      mockedReaddir.mockResolvedValue(["s1.json"] as unknown as ReturnType<typeof fs.readdir>);
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
        const cmd = _cmd as string;
        if (cmd.includes("pgrep")) {
          (callback as Function)(new Error("no children"), "", "");
        } else {
          // PID 1001 is alive
          (callback as Function)(null, "  PID  %CPU\n 1001  5.0\n", "");
        }
        return {} as ReturnType<typeof exec>;
      });

      await detector.detectSessions();
      expect(detector.getCpuHistory().has(1001)).toBe(true);

      // PID 1001 dies
      mockedExec.mockImplementation((_cmd, callback) => {
        const cmd = _cmd as string;
        if (cmd.includes("pgrep")) {
          (callback as Function)(new Error("no children"), "", "");
        } else {
          // No processes found
          (callback as Function)(null, "  PID  %CPU\n", "");
        }
        return {} as ReturnType<typeof exec>;
      });

      await detector.detectSessions();
      expect(detector.getCpuHistory().has(1001)).toBe(false);
    });
  });
});
