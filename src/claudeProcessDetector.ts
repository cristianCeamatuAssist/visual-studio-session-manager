import * as fs from "fs/promises";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";
import { CLAUDE_SESSIONS_DIR } from "./constants";
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

  constructor(cpuThreshold: number) {
    this.cpuThreshold = cpuThreshold;
  }

  setCpuThreshold(threshold: number): void {
    this.cpuThreshold = threshold;
  }

  async detectSessions(): Promise<ClaudeSession[]> {
    const rawSessions = await this.readSessionFiles();
    if (rawSessions.length === 0) {
      return [];
    }

    const cpuMap = await this.batchCheckProcesses(rawSessions.map((s) => s.pid));

    return rawSessions
      .filter((s) => cpuMap.has(s.pid))
      .map((s) => ({
        ...s,
        cpuPercent: cpuMap.get(s.pid) ?? 0,
      }));
  }

  getStatusForProject(
    projectPath: string,
    sessions: ClaudeSession[]
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
    const bestCpu = sorted[0].cpuPercent;

    if (bestCpu > this.cpuThreshold) {
      return { status: ClaudeSessionStatus.Active, sessions: sorted };
    }

    return { status: ClaudeSessionStatus.Waiting, sessions: sorted };
  }

  getActiveSessionCount(sessions: ClaudeSession[]): number {
    return sessions.length;
  }

  getActiveCount(sessions: ClaudeSession[]): number {
    return sessions.filter((s) => s.cpuPercent > this.cpuThreshold).length;
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
}
