import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { CONFIG_SECTION, CLAUDE_PROJECTS_DIR, CLAUDE_SESSIONS_DIR } from "./constants";
import { ProjectConfig } from "./types";

export class ProjectManager {
  getProjects(): ProjectConfig[] {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    return config.get<ProjectConfig[]>("projects", []);
  }

  async addProject(projectPath: string, name?: string): Promise<void> {
    const projects = this.getProjects();
    const normalized = projectPath.replace(/\/+$/, "");

    if (projects.some((p) => p.path.replace(/\/+$/, "") === normalized)) {
      vscode.window.showInformationMessage(`Project already exists: ${path.basename(normalized)}`);
      return;
    }

    const newProject: ProjectConfig = { path: normalized };
    if (name) {
      newProject.name = name;
    }

    projects.push(newProject);
    await this.saveProjects(projects);
  }

  async renameProject(projectPath: string, newName: string): Promise<void> {
    const projects = this.getProjects();
    const normalized = projectPath.replace(/\/+$/, "");
    const project = projects.find((p) => p.path.replace(/\/+$/, "") === normalized);
    if (project) {
      project.name = newName || undefined;
      await this.saveProjects(projects);
    }
  }

  async removeProject(projectPath: string): Promise<void> {
    const projects = this.getProjects();
    const normalized = projectPath.replace(/\/+$/, "");
    const filtered = projects.filter((p) => p.path.replace(/\/+$/, "") !== normalized);
    await this.saveProjects(filtered);
  }

  async autoDetectProjects(): Promise<ProjectConfig[]> {
    const detected = new Map<string, ProjectConfig>();

    // Strategy 1: Read CWDs from active session files (most reliable)
    await this.detectFromSessionFiles(detected);

    // Strategy 2: Scan ~/.claude/projects/ directory names
    await this.detectFromProjectsDir(detected);

    const existingPaths = new Set(this.getProjects().map((p) => p.path.replace(/\/+$/, "")));
    const newProjects: ProjectConfig[] = [];

    for (const [normalizedPath, config] of detected) {
      if (!existingPaths.has(normalizedPath)) {
        newProjects.push(config);
      }
    }

    if (newProjects.length > 0) {
      const allProjects = [...this.getProjects(), ...newProjects];
      await this.saveProjects(allProjects);
    }

    return newProjects;
  }

  private async detectFromSessionFiles(detected: Map<string, ProjectConfig>): Promise<void> {
    try {
      const files = await fs.readdir(CLAUDE_SESSIONS_DIR);
      for (const file of files.filter((f) => f.endsWith(".json"))) {
        try {
          const content = await fs.readFile(path.join(CLAUDE_SESSIONS_DIR, file), "utf-8");
          const data = JSON.parse(content);
          if (data.cwd) {
            const normalized = data.cwd.replace(/\/+$/, "");
            if (!detected.has(normalized)) {
              detected.set(normalized, {
                path: normalized,
                name: path.basename(normalized),
              });
            }
          }
        } catch {
          // skip
        }
      }
    } catch {
      // no sessions dir
    }
  }

  private async detectFromProjectsDir(detected: Map<string, ProjectConfig>): Promise<void> {
    try {
      const dirs = await fs.readdir(CLAUDE_PROJECTS_DIR);
      for (const dir of dirs) {
        const decoded = this.decodeProjectDirName(dir);
        if (decoded) {
          const normalized = decoded.replace(/\/+$/, "");
          // Only add if path actually exists on disk
          try {
            await fs.access(normalized);
            if (!detected.has(normalized)) {
              detected.set(normalized, {
                path: normalized,
                name: path.basename(normalized),
              });
            }
          } catch {
            // path doesn't exist, skip
          }
        }
      }
    } catch {
      // no projects dir
    }
  }

  /**
   * Decode Claude's project directory name encoding.
   * e.g. "-Users-cristianceamatu-therapist-assistant" -> "/Users/cristianceamatu/therapist-assistant"
   *
   * The encoding replaces "/" with "-". For paths containing actual hyphens,
   * we try to reconstruct by checking which segments exist on disk.
   */
  private decodeProjectDirName(encoded: string): string | null {
    if (!encoded.startsWith("-")) return null;

    // Replace leading dash with /
    const withSlashes = "/" + encoded.slice(1).replace(/-/g, "/");

    // Quick check: if this exact path exists, use it
    // This works for paths without hyphens in folder names
    try {
      // We'll do the existence check in the caller
      // For now, try the greedy approach: find the longest existing prefix
      return this.resolveEncodedPath(encoded);
    } catch {
      return withSlashes;
    }
  }

  /**
   * Greedily resolve an encoded path by testing segments against the filesystem.
   * Handles folder names with hyphens (e.g. "wella-react" encoded as "wella-react").
   */
  private resolveEncodedPath(encoded: string): string {
    // Remove leading dash
    const segments = encoded.slice(1).split("-");
    let resolved = "/";
    let i = 0;

    while (i < segments.length) {
      let found = false;
      // Try combining segments greedily (longest match first)
      for (let end = segments.length; end > i; end--) {
        const candidate = segments.slice(i, end).join("-");
        const testPath = path.join(resolved, candidate);
        try {
          // Synchronous check not available in async context, so we use a simple heuristic:
          // For the first two segments (Users/username), always use single segments
          if (i < 2) {
            const singleSegment = segments[i];
            resolved = path.join(resolved, singleSegment);
            i++;
            found = true;
            break;
          }
          // For deeper paths, try the full remaining as one name first
          resolved = testPath;
          i = end;
          found = true;
          break;
        } catch {
          continue;
        }
      }
      if (!found) {
        resolved = path.join(resolved, segments[i]);
        i++;
      }
    }

    return resolved;
  }

  private async saveProjects(projects: ProjectConfig[]): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
    await config.update("projects", projects, vscode.ConfigurationTarget.Global);
  }
}
