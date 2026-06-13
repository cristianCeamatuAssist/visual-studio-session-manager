import { exec } from "child_process";
import { promisify } from "util";
import type * as vscode from "vscode";

const execAsync = promisify(exec);
const MAX_PARENT_DEPTH = 15;

export function parseParentMap(stdout: string): Map<number, number> {
  const parentMap = new Map<number, number>();

  for (const line of stdout.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) {
      continue;
    }

    const pid = Number.parseInt(parts[0], 10);
    const parentPid = Number.parseInt(parts[1], 10);
    if (Number.isNaN(pid) || Number.isNaN(parentPid)) {
      continue;
    }

    parentMap.set(pid, parentPid);
  }

  return parentMap;
}

export function findOwningShellPid(
  targetPid: number,
  shellPids: Set<number>,
  parentMap: Map<number, number>
): number | undefined {
  const visited = new Set<number>();
  let currentPid: number | undefined = targetPid;

  for (let depth = 0; currentPid !== undefined && depth <= MAX_PARENT_DEPTH; depth++) {
    if (shellPids.has(currentPid)) {
      return currentPid;
    }

    if (visited.has(currentPid)) {
      return undefined;
    }
    visited.add(currentPid);

    currentPid = parentMap.get(currentPid);
  }

  return undefined;
}

export async function findTerminalForPid(
  targetPid: number,
  terminals: readonly vscode.Terminal[]
): Promise<vscode.Terminal | undefined> {
  const terminalPidMap = new Map<number, vscode.Terminal>();

  for (const terminal of terminals) {
    let processId: number | undefined;
    try {
      processId = await terminal.processId;
    } catch {
      continue;
    }

    if (processId !== undefined) {
      terminalPidMap.set(processId, terminal);
    }
  }

  let stdout: string;
  try {
    ({ stdout } = await execAsync("ps -axo pid,ppid"));
  } catch {
    return undefined;
  }

  const owningShellPid = findOwningShellPid(
    targetPid,
    new Set(terminalPidMap.keys()),
    parseParentMap(stdout)
  );

  return owningShellPid === undefined ? undefined : terminalPidMap.get(owningShellPid);
}
