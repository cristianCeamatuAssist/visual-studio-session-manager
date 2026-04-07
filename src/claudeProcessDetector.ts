import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { CLAUDE_SESSIONS_DIR, DEBOUNCE_READINGS } from "./constants";
import { ClaudeSession, ClaudeSessionStatus } from "./types";

const execAsync = promisify(exec);

interface RawSessionData {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: string;
  entrypoint?: string;
}

export class ClaudeProcessDetector {
  private cpuThreshold: number;

  /**
   * Tracks CPU readings per PID across polling cycles for debouncing.
   * Each entry stores the last N effective CPU readings (including child processes).
   */
  private cpuHistory: Map<number, number[]> = new Map();

  constructor(cpuThreshold: number) {
    this.cpuThreshold = cpuThreshold;
  }

  setCpuThreshold(threshold: number): void {
    this.cpuThreshold = threshold;
  }

  async detectSessions(hooksInstalled = false): Promise<ClaudeSession[]> {
    const rawSessions = await this.readSessionFiles();
    if (rawSessions.length === 0) {
      this.cpuHistory.clear();
      return [];
    }

    // Hooks mode: skip all CPU detection, just return sessions with cpuPercent = -1
    if (hooksInstalled) {
      return rawSessions.map((s) => ({
        ...s,
        cpuPercent: -1,
      }));
    }

    const pids = rawSessions.map((s) => s.pid);
    const cpuMap = await this.batchCheckProcesses(pids);

    // Check child process CPU for subagent detection
    const childCpuMap = await this.getChildProcessCpu(
      pids.filter((pid) => cpuMap.has(pid))
    );

    // Build effective CPU map (own + children)
    const effectiveCpuMap = new Map<number, number>();
    for (const pid of pids) {
      if (!cpuMap.has(pid)) continue;
      const ownCpu = cpuMap.get(pid) ?? 0;
      const childCpu = childCpuMap.get(pid) ?? 0;
      effectiveCpuMap.set(pid, ownCpu + childCpu);
    }

    // Update CPU history for debouncing
    for (const [pid, cpu] of effectiveCpuMap) {
      const history = this.cpuHistory.get(pid) ?? [];
      history.push(cpu);
      if (history.length > DEBOUNCE_READINGS) {
        history.shift();
      }
      this.cpuHistory.set(pid, history);
    }

    // Clean up history for dead PIDs
    for (const pid of this.cpuHistory.keys()) {
      if (!effectiveCpuMap.has(pid)) {
        this.cpuHistory.delete(pid);
      }
    }

    return rawSessions
      .filter((s) => cpuMap.has(s.pid))
      .map((s) => ({
        ...s,
        cpuPercent: effectiveCpuMap.get(s.pid) ?? 0,
      }));
  }

  getStatusForProject(
    projectPath: string,
    sessions: ClaudeSession[],
    hookWaitingMarkers?: Set<string>,
    hooksInstalled = false
  ): { status: ClaudeSessionStatus; sessions: ClaudeSession[] } {
    const normalized = projectPath.replace(/\/+$/, "");
    const matching = sessions.filter((s) => {
      const sessionCwd = s.cwd.replace(/\/+$/, "");
      return sessionCwd === normalized || sessionCwd.startsWith(normalized + "/");
    });

    if (matching.length === 0) {
      return { status: ClaudeSessionStatus.Inactive, sessions: [] };
    }

    const sorted = matching.sort((a, b) => b.cpuPercent - a.cpuPercent);

    // Hooks mode: marker-only status determination, no CPU logic
    if (hooksInstalled) {
      const waitingMarkers = hookWaitingMarkers ?? new Set<string>();

      const allWaiting = matching.every(
        (s) => waitingMarkers.has(String(s.pid))
      );

      if (allWaiting) {
        return { status: ClaudeSessionStatus.Waiting, sessions: sorted };
      }
      return { status: ClaudeSessionStatus.Active, sessions: sorted };
    }

    // CPU mode: existing logic unchanged
    const bestCpu = sorted[0].cpuPercent;

    if (bestCpu > this.cpuThreshold) {
      return { status: ClaudeSessionStatus.Active, sessions: sorted };
    }

    if (hookWaitingMarkers && hookWaitingMarkers.size > 0) {
      const isHookConfirmedWaiting = matching.some(
        (s) => hookWaitingMarkers.has(String(s.pid))
      );
      if (isHookConfirmedWaiting) {
        return { status: ClaudeSessionStatus.Waiting, sessions: sorted };
      }
      return { status: ClaudeSessionStatus.Active, sessions: sorted };
    }

    const isConfirmedWaiting = matching.every((s) => {
      const history = this.cpuHistory.get(s.pid);
      if (!history || history.length < DEBOUNCE_READINGS) {
        return false;
      }
      return history.every((cpu) => cpu <= this.cpuThreshold);
    });

    if (isConfirmedWaiting) {
      return { status: ClaudeSessionStatus.Waiting, sessions: sorted };
    }

    return { status: ClaudeSessionStatus.Active, sessions: sorted };
  }

  getActiveSessionCount(sessions: ClaudeSession[]): number {
    return sessions.length;
  }

  getActiveCount(sessions: ClaudeSession[]): number {
    return sessions.filter((s) => s.cpuPercent > this.cpuThreshold).length;
  }

  /** Expose CPU history for testing */
  getCpuHistory(): Map<number, number[]> {
    return this.cpuHistory;
  }

  private async readSessionFiles(): Promise<RawSessionData[]> {
    try {
      const files = await fs.readdir(CLAUDE_SESSIONS_DIR);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      const sessions: RawSessionData[] = [];

      for (const file of jsonFiles) {
        try {
          const content = await fs.readFile(path.join(CLAUDE_SESSIONS_DIR, file), "utf-8");
          const data = JSON.parse(content) as RawSessionData;
          if (data.pid && data.cwd && data.sessionId) {
            sessions.push(data);
          }
        } catch {
          // Skip corrupt or partially written files
        }
      }

      return sessions;
    } catch {
      // Sessions directory doesn't exist yet
      return [];
    }
  }

  private async batchCheckProcesses(pids: number[]): Promise<Map<number, number>> {
    const cpuMap = new Map<number, number>();
    if (pids.length === 0) return cpuMap;

    try {
      const pidList = pids.join(",");
      const { stdout } = await execAsync(`ps -p ${pidList} -o pid,%cpu 2>/dev/null`);
      const lines = stdout.trim().split("\n").slice(1); // skip header

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const pid = parseInt(parts[0], 10);
          const cpu = parseFloat(parts[1]);
          if (!isNaN(pid) && !isNaN(cpu)) {
            cpuMap.set(pid, cpu);
          }
        }
      }
    } catch {
      // ps command failed — processes likely don't exist
    }

    return cpuMap;
  }

  /**
   * Check CPU usage of child processes for each parent PID.
   * This catches subagents spawned by Claude that are actively working
   * while the parent process idles.
   */
  private async getChildProcessCpu(parentPids: number[]): Promise<Map<number, number>> {
    const childCpuMap = new Map<number, number>();
    if (parentPids.length === 0) return childCpuMap;

    for (const parentPid of parentPids) {
      try {
        // pgrep -P gives direct children; works on macOS and Linux
        const { stdout } = await execAsync(`pgrep -P ${parentPid} 2>/dev/null`);
        const childPids = stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(Number)
          .filter((n) => !isNaN(n));

        if (childPids.length > 0) {
          const childCpus = await this.batchCheckProcesses(childPids);
          let totalChildCpu = 0;
          for (const cpu of childCpus.values()) {
            totalChildCpu += cpu;
          }
          if (totalChildCpu > 0) {
            childCpuMap.set(parentPid, totalChildCpu);
          }
        }
      } catch {
        // No children or pgrep not available
      }
    }

    return childCpuMap;
  }
}
