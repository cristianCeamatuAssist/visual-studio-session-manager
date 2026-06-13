import * as fs from "fs/promises";
import * as path from "path";
import { VSCODE_WORKSPACES_DIR } from "./constants";
import { WorkspaceEntry, WorkspaceRegistrationInput } from "./types";

interface RawWorkspaceEntry {
  pid?: unknown;
  folder?: unknown;
  folders?: unknown;
  name?: unknown;
  kind?: unknown;
  workspaceFile?: unknown;
  lastSeen?: unknown;
}

function normalizePath(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeFolders(folders: string[]): string[] {
  return folders.map(normalizePath).filter(Boolean);
}

export class WorkspaceRegistry {
  async register(input: WorkspaceRegistrationInput): Promise<void> {
    await fs.mkdir(VSCODE_WORKSPACES_DIR, { recursive: true });

    const folders = normalizeFolders(input.folders);
    const folder = folders[0];
    const workspaceFile = input.workspaceFile
      ? normalizePath(input.workspaceFile)
      : undefined;

    const entry: WorkspaceEntry = {
      pid: input.pid,
      folder,
      folders,
      name: input.name,
      kind: input.kind,
      workspaceFile,
      lastSeen: Date.now(),
    };

    await fs.writeFile(
      path.join(VSCODE_WORKSPACES_DIR, `${input.pid}.json`),
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

  async heartbeat(input: WorkspaceRegistrationInput): Promise<void> {
    await this.register(input);
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
        const entry = this.normalizeEntry(JSON.parse(content) as RawWorkspaceEntry);

        if (!entry) continue;

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

    // Deduplicate by workspace file when present, otherwise folder path; keep newest lastSeen.
    const byIdentity = new Map<string, WorkspaceEntry>();
    for (const entry of workspaces) {
      const key = entry.workspaceFile ?? entry.folder;
      const existing = byIdentity.get(key);
      if (!existing || entry.lastSeen > existing.lastSeen) {
        byIdentity.set(key, entry);
      }
    }

    return Array.from(byIdentity.values());
  }

  private normalizeEntry(raw: RawWorkspaceEntry): WorkspaceEntry | undefined {
    if (typeof raw.pid !== "number") return undefined;

    const rawFolders = Array.isArray(raw.folders)
      ? raw.folders.filter((folder): folder is string => typeof folder === "string")
      : [];
    const folderFromLegacy = typeof raw.folder === "string" ? raw.folder : undefined;
    const folders = normalizeFolders(rawFolders.length > 0 ? rawFolders : folderFromLegacy ? [folderFromLegacy] : []);
    const folder = typeof raw.folder === "string" ? normalizePath(raw.folder) : folders[0];

    if (!folder || folders.length === 0) return undefined;

    const workspaceFile = typeof raw.workspaceFile === "string"
      ? normalizePath(raw.workspaceFile)
      : undefined;
    const kind = workspaceFile || raw.kind === "workspace" ? "workspace" : "folder";
    const name = typeof raw.name === "string" && raw.name.length > 0
      ? raw.name
      : path.basename(folder);
    const lastSeen = typeof raw.lastSeen === "number" ? raw.lastSeen : 0;

    return {
      pid: raw.pid,
      folder,
      folders,
      name,
      kind,
      workspaceFile,
      lastSeen,
    };
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
