import * as fs from "fs/promises";
import * as path from "path";

export interface WorktreeInfo {
  isWorktree: boolean;
  mainRepoRoot?: string;
}

export async function resolveWorktree(folder: string): Promise<WorktreeInfo> {
  const gitPath = path.join(folder, ".git");

  try {
    const gitStat = await fs.stat(gitPath);
    if (gitStat.isDirectory()) {
      return { isWorktree: false };
    }

    if (!gitStat.isFile()) {
      return { isWorktree: false };
    }
  } catch {
    return { isWorktree: false };
  }

  try {
    const content = await fs.readFile(gitPath, "utf-8");
    const gitdirPath = parseGitdir(content);
    if (!gitdirPath) {
      return { isWorktree: false };
    }

    const resolvedGitdir = path.isAbsolute(gitdirPath)
      ? path.normalize(gitdirPath)
      : path.resolve(folder, gitdirPath);
    const mainRepoRoot = getMainRepoRoot(resolvedGitdir);

    if (!mainRepoRoot) {
      return { isWorktree: false };
    }

    return { isWorktree: true, mainRepoRoot };
  } catch {
    return { isWorktree: false };
  }
}

function parseGitdir(content: string): string | undefined {
  const match = content.match(/^gitdir:\s*(.+)\s*$/m);
  return match?.[1]?.trim();
}

function getMainRepoRoot(gitdirPath: string): string | undefined {
  const worktreesDir = path.dirname(gitdirPath);
  const gitDir = path.dirname(worktreesDir);
  if (path.basename(worktreesDir) !== "worktrees" || path.basename(gitDir) !== ".git") {
    return undefined;
  }

  return path.dirname(gitDir);
}
