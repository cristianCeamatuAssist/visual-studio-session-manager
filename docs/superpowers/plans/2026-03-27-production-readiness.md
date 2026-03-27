# Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the claude-sessions VS Code extension production-ready with proper branding, documentation, tests, and publish to GitHub.

**Architecture:** Rename branding to "Visual Studio Session Manager", add MIT license + README + CHANGELOG, add vitest unit tests for the two core logic classes (ProjectManager, ClaudeProcessDetector), then init git and push to GitHub with a v0.1.0 release.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest (testing), esbuild (bundling), GitHub CLI (`gh`)

---

### Task 1: Rename Branding in package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Update package.json metadata**

Change these fields in `package.json`:

```json
{
  "name": "vscode-session-manager",
  "displayName": "Visual Studio Session Manager",
  "description": "Monitor and switch between VS Code projects with Claude Code CLI session status indicators",
  "version": "0.1.0",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/cristianCeamatuAssist/visual-studio-session-manager"
  },
  "homepage": "https://github.com/cristianCeamatuAssist/visual-studio-session-manager#readme",
  "bugs": {
    "url": "https://github.com/cristianCeamatuAssist/visual-studio-session-manager/issues"
  },
  "engines": {
    "vscode": "^1.74.0"
  },
  "categories": [
    "Other"
  ]
}
```

Remove the `"publisher": "cristianceamatu"` line entirely.

Keep all `contributes`, `scripts`, `devDependencies` unchanged. The internal command prefix `claudeSessions` stays as-is.

- [ ] **Step 2: Verify the extension still compiles**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx tsc --noEmit`
Expected: No errors (branding changes are metadata-only, no code affected).

- [ ] **Step 3: Commit**

```bash
cd /Users/cristianceamatu/wd/claude-sessions-ext
git add package.json
git commit -m "chore: rename branding to Visual Studio Session Manager"
```

(Git init happens in Task 6 — skip this commit step if git isn't initialized yet. In that case, these changes will be included in the initial commit.)

---

### Task 2: Add LICENSE

**Files:**
- Create: `LICENSE`

- [ ] **Step 1: Create MIT LICENSE file**

Create `LICENSE` in the project root with this exact content:

```
MIT License

Copyright (c) 2026 Cristian Ceamatu

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

### Task 3: Add README.md

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

Create `README.md` in the project root:

```markdown
# Visual Studio Session Manager

Monitor and switch between VS Code projects with Claude Code CLI session status indicators.

## Features

- **Project Sidebar** — See all your projects in a dedicated activity bar panel with live session status (active/waiting/inactive)
- **Session Monitoring** — Detects running Claude Code CLI sessions by reading `~/.claude/sessions/` and checking process status
- **Smart Window Switching** — Click a project to switch to it. On macOS, the new window appears in the exact same position for seamless switching
- **Auto-Detect Projects** — Automatically discovers projects from your Claude Code session history
- **Expandable Sessions** — Expand a project to see individual sessions with PID, CPU usage, and start time
- **Status Bar** — Shows total Claude session count with color-coded status
- **Terminal Integration** — Open a terminal at any project directory with one click

## Requirements

- macOS (window positioning uses AppleScript)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and used at least once
- VS Code 1.74 or later

## Installation

1. Download the latest `.vsix` file from [Releases](https://github.com/cristianCeamatuAssist/visual-studio-session-manager/releases)
2. Install it:

```bash
code --install-extension vscode-session-manager-0.1.0.vsix
```

Or in VS Code: `Cmd+Shift+P` → "Extensions: Install from VSIX..." → select the downloaded file.

## Usage

1. Open the **Session Manager** panel in the activity bar (terminal icon on the left sidebar)
2. Click **Auto-Detect** (magnifying glass icon) to discover projects from your Claude history
3. Or click **+** to manually add project folders
4. Projects show live status:
   - 🟢 **Active** — Claude is actively working (high CPU)
   - 🟡 **Waiting** — Claude session is idle, waiting for input
   - ⚫ **Inactive** — No running sessions
5. Click a project to switch to it. Right-click for more options (rename, remove, open terminal, open in new window)

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `claudeSessions.pollingInterval` | `3000` | How often to check session status (ms) |
| `claudeSessions.cpuThreshold` | `5.0` | CPU% above which a session is "active" vs "waiting" |
| `claudeSessions.showStatusBar` | `true` | Show session count in the status bar |

## How It Works

The extension reads JSON session files from `~/.claude/sessions/` to discover running Claude Code CLI sessions. It then uses `ps` to check if each session's process is still alive and how much CPU it's consuming. Sessions are matched to projects by comparing the session's working directory (`cwd`) against your registered project paths.

Window switching on macOS uses AppleScript to capture the current window position before opening a new project, then repositions the new window to the same coordinates — giving the impression that you never left.

## License

MIT
```

---

### Task 4: Add CHANGELOG.md

**Files:**
- Create: `CHANGELOG.md`

- [ ] **Step 1: Create CHANGELOG.md**

Create `CHANGELOG.md` in the project root:

```markdown
# Changelog

## [0.1.0] - 2026-03-27

### Added

- Project sidebar with live Claude Code CLI session status indicators
- Auto-detect projects from Claude session history (`~/.claude/sessions/` and `~/.claude/projects/`)
- Smart window switching with macOS AppleScript window position preservation
- Expandable project nodes showing individual sessions (PID, CPU%, start time)
- Status bar showing total session count with color-coded status
- Add, remove, and rename projects
- Open terminal at project directory
- Configurable polling interval, CPU threshold, and status bar visibility
```

---

### Task 5: Set Up Vitest Test Infrastructure

**Files:**
- Modify: `package.json` (add vitest devDependency and test script)
- Create: `vitest.config.ts`
- Create: `src/__tests__/__mocks__/vscode.ts`

- [ ] **Step 1: Install vitest**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npm install --save-dev vitest`

- [ ] **Step 2: Add test script to package.json**

Add to `scripts` in `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create vitest.config.ts**

Create `vitest.config.ts` in the project root:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/__tests__/**/*.test.ts"],
    alias: {
      vscode: path.resolve(__dirname, "src/__tests__/__mocks__/vscode.ts"),
    },
  },
});
```

- [ ] **Step 4: Create vscode mock**

Create `src/__tests__/__mocks__/vscode.ts`:

```typescript
const configStore: Record<string, Record<string, unknown>> = {
  claudeSessions: {
    projects: [],
    pollingInterval: 3000,
    cpuThreshold: 5.0,
    showStatusBar: true,
  },
};

const workspace = {
  getConfiguration(section: string) {
    const store = configStore[section] ?? {};
    return {
      get<T>(key: string, defaultValue?: T): T {
        const value = store[key];
        return (value !== undefined ? value : defaultValue) as T;
      },
      async update(key: string, value: unknown, _target?: unknown): Promise<void> {
        if (!configStore[section]) {
          configStore[section] = {};
        }
        configStore[section][key] = value;
      },
    };
  },
};

const window = {
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  showOpenDialog: vi.fn(),
  showInputBox: vi.fn(),
  createStatusBarItem: vi.fn(() => ({
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    text: "",
    tooltip: "",
    color: undefined,
    command: undefined,
    name: undefined,
  })),
  createTerminal: vi.fn(),
};

const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
};

const StatusBarAlignment = {
  Left: 1,
  Right: 2,
};

const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: "file" }),
};

const EventEmitter = vi.fn().mockImplementation(() => ({
  event: vi.fn(),
  fire: vi.fn(),
  dispose: vi.fn(),
}));

const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
};

class TreeItem {
  label: string;
  collapsibleState: number;
  description?: string;
  tooltip?: unknown;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;

  constructor(label: string, collapsibleState: number = 0) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

const ThemeIcon = vi.fn().mockImplementation((id: string) => ({ id }));
const ThemeColor = vi.fn().mockImplementation((id: string) => ({ id }));

class MarkdownString {
  value = "";
  appendMarkdown(text: string) {
    this.value += text;
  }
}

export function _resetConfigStore(): void {
  configStore.claudeSessions = {
    projects: [],
    pollingInterval: 3000,
    cpuThreshold: 5.0,
    showStatusBar: true,
  };
}

export {
  workspace,
  window,
  ConfigurationTarget,
  StatusBarAlignment,
  Uri,
  EventEmitter,
  TreeItemCollapsibleState,
  TreeItem,
  ThemeIcon,
  ThemeColor,
  MarkdownString,
};
```

- [ ] **Step 5: Verify vitest runs (no tests yet, should report 0)**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx vitest run`
Expected: "No test files found" or similar — confirms vitest is configured correctly.

- [ ] **Step 6: Update .vscodeignore to exclude test files**

Add these lines to `.vscodeignore`:

```
vitest.config.ts
src/__tests__/**
```

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts package.json package-lock.json src/__tests__/__mocks__/vscode.ts .vscodeignore
git commit -m "chore: set up vitest test infrastructure with vscode mock"
```

---

### Task 6: Write Unit Tests for ProjectManager

**Files:**
- Create: `src/__tests__/projectManager.test.ts`

The `ProjectManager` class has methods that depend on `vscode.workspace.getConfiguration` (mocked in Task 5) and `fs` (needs mocking). The methods `decodeProjectDirName` and `resolveEncodedPath` are private, but they're exercised through `autoDetectProjects` which calls `detectFromProjectsDir` → `decodeProjectDirName` → `resolveEncodedPath`. We'll test them through the public API.

- [ ] **Step 1: Write projectManager tests**

Create `src/__tests__/projectManager.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx vitest run src/__tests__/projectManager.test.ts`
Expected: All tests pass. If any fail, fix the test or the mock — the extension code should not change.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/projectManager.test.ts
git commit -m "test: add unit tests for ProjectManager"
```

---

### Task 7: Write Unit Tests for ClaudeProcessDetector

**Files:**
- Create: `src/__tests__/claudeProcessDetector.test.ts`

The `ClaudeProcessDetector` class reads session files from disk and runs `ps` to check processes. We mock `fs/promises` and `child_process` to test the logic.

- [ ] **Step 1: Write claudeProcessDetector tests**

Create `src/__tests__/claudeProcessDetector.test.ts`:

```typescript
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
      // Return a function that wraps exec mock as a promise
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

      // ps returns only PID 1001 (1002 is dead)
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
      mockedReadFile.mockResolvedValue(JSON.stringify({ pid: 123 })); // missing cwd and sessionId

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

      // Default threshold is 5.0, so 8.0 > 5.0 = Active
      expect(detector.getStatusForProject("/project", sessions).status).toBe(ClaudeSessionStatus.Active);

      // Raise threshold to 10.0, now 8.0 < 10.0 = Waiting
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
      expect(detector.getActiveCount(sessions)).toBe(2); // 20.0 and 8.0 > 5.0
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx vitest run src/__tests__/claudeProcessDetector.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Run all tests together**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx vitest run`
Expected: All tests from both files pass.

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/claudeProcessDetector.test.ts
git commit -m "test: add unit tests for ClaudeProcessDetector"
```

---

### Task 8: Git Init, .gitignore, and Initial Commit

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: Create .gitignore**

Create `.gitignore` in the project root:

```
node_modules/
dist/
*.vsix
.DS_Store
```

- [ ] **Step 2: Initialize git repo and make initial commit**

```bash
cd /Users/cristianceamatu/wd/claude-sessions-ext
git init
git add .gitignore LICENSE README.md CHANGELOG.md package.json package-lock.json tsconfig.json vitest.config.ts esbuild.mjs .vscodeignore .vscode/ src/ resources/ docs/
git commit -m "feat: initial release of Visual Studio Session Manager v0.1.0

Monitor and switch between VS Code projects with Claude Code CLI
session status indicators. Features: project sidebar with live status,
auto-detect from Claude history, smart macOS window switching,
expandable sessions, status bar, and terminal integration."
```

- [ ] **Step 3: Add remote and push**

```bash
cd /Users/cristianceamatu/wd/claude-sessions-ext
git remote add origin git@github.com:cristianCeamatuAssist/visual-studio-session-manager.git
git branch -M main
git push -u origin main
```

---

### Task 9: Build .vsix and Create GitHub Release

**Files:**
- No file changes — build and release only

- [ ] **Step 1: Build the .vsix package**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx @vscode/vsce package --no-dependencies --allow-missing-repository`
Expected: Creates `vscode-session-manager-0.1.0.vsix` (name changed due to package.json rename).

- [ ] **Step 2: Create GitHub Release with .vsix attached**

```bash
cd /Users/cristianceamatu/wd/claude-sessions-ext
gh release create v0.1.0 vscode-session-manager-0.1.0.vsix \
  --repo cristianCeamatuAssist/visual-studio-session-manager \
  --title "v0.1.0 — Initial Release" \
  --notes "$(cat <<'EOF'
## Visual Studio Session Manager v0.1.0

Monitor and switch between VS Code projects with Claude Code CLI session status indicators.

### Features

- Project sidebar with live session status (active/waiting/inactive)
- Auto-detect projects from Claude session history
- Smart window switching with macOS window position preservation
- Expandable sessions showing PID, CPU%, and start time
- Status bar with session count
- Add, remove, rename projects
- Open terminal at project directory

### Install

```bash
code --install-extension vscode-session-manager-0.1.0.vsix
```

Or in VS Code: Cmd+Shift+P → "Extensions: Install from VSIX..."

### Requirements

- macOS
- Claude Code CLI
- VS Code 1.74+
EOF
)"
```

Expected: Release created at `https://github.com/cristianCeamatuAssist/visual-studio-session-manager/releases/tag/v0.1.0`

- [ ] **Step 3: Verify the release page**

Run: `gh release view v0.1.0 --repo cristianCeamatuAssist/visual-studio-session-manager`
Expected: Shows the release with the `.vsix` asset attached.
