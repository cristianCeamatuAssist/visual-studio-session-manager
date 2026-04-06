import * as fs from "fs/promises";
import * as path from "path";
import { VSCODE_WORKSPACES_DIR } from "./constants";
import { WorkspaceEntry } from "./types";

export class WorkspaceRegistry {
  async register(pid: number, folderPath: string): Promise<void> {
    await fs.mkdir(VSCODE_WORKSPACES_DIR, { recursive: true });

    const normalized = folderPath.replace(/\/+$/, "");
    const entry: WorkspaceEntry = {
      pid,
      folder: normalized,
      name: path.basename(normalized),
      lastSeen: Date.now(),
    };

    await fs.writeFile(
      path.join(VSCODE_WORKSPACES_DIR, `${pid}.json`),
      JSON.stringify(entry),
      "utf-8"
    );
  }

  async unregister(pid: number): Promise<void> {
    try {
      await fs.unlink(path.join(VSCODE_WORKSPACES_DIR, `${pid}.json`));
    } catch {
      // File may not exist — that's fine
    }
  }

  async heartbeat(pid: number, folderPath: string): Promise<void> {
    await this.register(pid, folderPath);
  }

  async getActiveWorkspaces(): Promise<WorkspaceEntry[]> {
    let files: string[];
    try {
      const entries = await fs.readdir(VSCODE_WORKSPACES_DIR);
      files = entries.filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }

    const workspaces: WorkspaceEntry[] = [];

    for (const file of files) {
      try {
        const content = await fs.readFile(
          path.join(VSCODE_WORKSPACES_DIR, file),
          "utf-8"
        );
        const entry = JSON.parse(content) as WorkspaceEntry;

        if (!entry.pid || !entry.folder) continue;

        const alive = this.isPidAlive(entry.pid);
        if (!alive) {
          await fs.unlink(path.join(VSCODE_WORKSPACES_DIR, file)).catch(() => {});
          continue;
        }

        workspaces.push(entry);
      } catch {
        // Skip corrupt files
      }
    }

    // Deduplicate by folder path — keep the entry with the most recent lastSeen
    const byFolder = new Map<string, WorkspaceEntry>();
    for (const entry of workspaces) {
      const existing = byFolder.get(entry.folder);
      if (!existing || entry.lastSeen > existing.lastSeen) {
        byFolder.set(entry.folder, entry);
      }
    }

    return Array.from(byFolder.values());
  }

  private isPidAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}
