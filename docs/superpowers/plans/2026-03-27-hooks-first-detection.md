# Hooks-First Session Status Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CPU-based session status detection with deterministic Claude Code hook events when hooks are installed, eliminating the green/yellow flickering. Use a user-centric color scheme: yellow = working, red = needs your input, gray = inactive.

**Architecture:** Two-mode detector — hooks mode (marker files + process liveness, no CPU) and CPU mode (existing debounce logic, unchanged). The hook script expands from 2 events (Stop, PreToolUse) to 5 events (+ UserPromptSubmit, Notification with idle_prompt matcher, SessionEnd). When hooks are installed, all `ps`/`pgrep` calls are skipped.

**Status Model (hooks mode):**

| Hook Event | Trigger | Status | Color | Meaning |
|------------|---------|--------|-------|---------|
| `UserPromptSubmit` | User sent a message | Working | Yellow | Claude is busy |
| `PreToolUse` | Tool about to run | Working | Yellow | Claude is busy |
| `Stop` | Claude finished responding | Needs input | Red | Your turn |
| `Notification` (idle_prompt) | Claude idle, waiting | Needs input | Red | Your turn |
| `SessionEnd` | Session terminated | Inactive | Gray | Nothing to do |

**Tech Stack:** TypeScript, VS Code Extension API, vitest, Claude Code CLI hooks (bash)

---

### File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/constants.ts` | Modify | Add `HOOKS_POLLING_INTERVAL` constant |
| `src/hookManager.ts` | Modify | Expand hook script to 5 events, install/uninstall all 5 hooks |
| `src/claudeProcessDetector.ts` | Modify | Add `hooksInstalled` param, skip CPU in hooks mode, marker-only status logic |
| `src/projectTreeProvider.ts` | Modify | Pass `hooksInstalled`, drop CPU% from descriptions in hooks mode |
| `src/statusBarManager.ts` | Modify | Pass `hooksInstalled`, drop CPU% from display in hooks mode |
| `src/extension.ts` | Modify | Cache `hooksInstalled` state, pass to components, adjust polling interval |
| `src/__tests__/hookManager.test.ts` | Modify | Test 4-hook install/uninstall, updated isInstalled detection |
| `src/__tests__/claudeProcessDetector.test.ts` | Modify | Test hooks-only status logic, verify no CPU calls in hooks mode |

---

### Task 1: Add HOOKS_POLLING_INTERVAL constant

**Files:**
- Modify: `src/constants.ts`

- [ ] **Step 1: Add the constant**

In `src/constants.ts`, add after the `WAITING_MARKER_PREFIX` line:

```typescript
/** Polling interval when hooks are installed (less frequent since file watcher handles immediacy) */
export const HOOKS_POLLING_INTERVAL = 5000;
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/constants.ts
git commit -m "feat: add HOOKS_POLLING_INTERVAL constant for hooks-first detection"
```

---

### Task 2: Expand hook script and install/uninstall all 5 hooks

**Files:**
- Modify: `src/hookManager.ts`
- Modify: `src/__tests__/hookManager.test.ts`

- [ ] **Step 1: Write failing tests for 5-hook installation**

In `src/__tests__/hookManager.test.ts`, add to the `installHooks` describe block:

```typescript
it("installs all 5 hook events (Stop, PreToolUse, UserPromptSubmit, Notification, SessionEnd)", async () => {
  mockedReadFile.mockRejectedValue(new Error("ENOENT"));
  mockedWriteFile.mockResolvedValue(undefined);

  await hookManager.installHooks();

  const settingsCall = mockedWriteFile.mock.calls.find(
    (call) => call[0]?.toString().includes("settings.json")
  );
  expect(settingsCall).toBeDefined();
  const written = JSON.parse(settingsCall![1] as string);
  expect(written.hooks.Stop).toHaveLength(1);
  expect(written.hooks.PreToolUse).toHaveLength(1);
  expect(written.hooks.UserPromptSubmit).toHaveLength(1);
  expect(written.hooks.Notification).toHaveLength(1);
  expect(written.hooks.SessionEnd).toHaveLength(1);
  expect(written.hooks.Stop[0].hooks[0].command).toContain("stop");
  expect(written.hooks.PreToolUse[0].hooks[0].command).toContain("resume");
  expect(written.hooks.UserPromptSubmit[0].hooks[0].command).toContain("start");
  expect(written.hooks.Notification[0].matcher).toBe("idle_prompt");
  expect(written.hooks.Notification[0].hooks[0].command).toContain("stop");
  expect(written.hooks.SessionEnd[0].hooks[0].command).toContain("end");
});
```

Add a new test for `isInstalled` that checks any of the 5 hooks:

```typescript
it("returns true when UserPromptSubmit hook is present (even if Stop is missing)", async () => {
  mockedReadFile.mockResolvedValue(
    JSON.stringify({
      hooks: {
        UserPromptSubmit: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh start" }],
          },
        ],
      },
    })
  );
  const result = await hookManager.isInstalled();
  expect(result).toBe(true);
});
```

Add tests for uninstall of all 5 hooks:

```typescript
it("removes all 5 hook events when uninstalling", async () => {
  mockedReadFile.mockResolvedValue(
    JSON.stringify({
      hooks: {
        Stop: [
          { matcher: "", hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh stop" }] },
        ],
        PreToolUse: [
          { matcher: "", hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh resume" }] },
        ],
        UserPromptSubmit: [
          { matcher: "", hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh start" }] },
        ],
        Notification: [
          { matcher: "idle_prompt", hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh stop" }] },
        ],
        SessionEnd: [
          { matcher: "", hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh end" }] },
        ],
      },
    })
  );
  mockedWriteFile.mockResolvedValue(undefined);
  mockedUnlink.mockResolvedValue(undefined);
  mockedReaddir.mockResolvedValue([] as unknown as ReturnType<typeof fs.readdir>);

  const result = await hookManager.uninstallHooks();
  expect(result).toBe(true);

  const settingsCall = mockedWriteFile.mock.calls.find(
    (call) => call[0]?.toString().includes("settings.json")
  );
  const written = JSON.parse(settingsCall![1] as string);
  // All hook arrays should be removed (empty → deleted)
  expect(written.hooks).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx vitest run src/__tests__/hookManager.test.ts`
Expected: The 3 new tests FAIL (only 2 hooks installed currently, `isInstalled` only checks Stop)

- [ ] **Step 3: Update hook script in hookManager.ts**

Replace the `getHookScriptContent()` function:

```typescript
function getHookScriptContent(): string {
  return `#!/bin/bash
# Visual Studio Session Manager - Claude CLI hook helper
# Manages waiting marker files for accurate session status detection
ACTION="$1"
SESSIONS_DIR="$HOME/.claude/sessions"
MARKER_PREFIX="${WAITING_MARKER_PREFIX}"

# Extract session_id from stdin JSON (hook event payload)
INPUT=$(cat)
SESSION_ID=$(echo "$INPUT" | grep -o '"session_id":"[^"]*"' | head -1 | cut -d'"' -f4)

# Fallback to PPID if session_id not available
MARKER_ID="\${SESSION_ID:-$PPID}"

if [ -n "$MARKER_ID" ]; then
  case "$ACTION" in
    stop)
      # Claude finished responding — session is now waiting for input
      touch "$SESSIONS_DIR/$MARKER_PREFIX$MARKER_ID"
      ;;
    resume|start)
      # Tool about to run OR user submitted prompt — session is active
      rm -f "$SESSIONS_DIR/$MARKER_PREFIX$MARKER_ID"
      ;;
    end)
      # Session terminated — clean up marker
      rm -f "$SESSIONS_DIR/$MARKER_PREFIX$MARKER_ID"
      ;;
  esac
fi
`;
}
```

- [ ] **Step 4: Update isInstalled() to check any of the 5 hooks**

Replace the `isInstalled()` method:

```typescript
async isInstalled(): Promise<boolean> {
  try {
    const content = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
    const settings: ClaudeSettings = JSON.parse(content);
    const hookEvents = ["Stop", "PreToolUse", "UserPromptSubmit", "Notification", "SessionEnd"] as const;
    return hookEvents.some((event) => {
      const eventHooks = settings.hooks?.[event] ?? [];
      return eventHooks.some((h) =>
        h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
      );
    });
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Update installHooks() to add UserPromptSubmit, Notification, and SessionEnd**

In `installHooks()`, after the existing PreToolUse block (after line 121), add:

```typescript
// Add UserPromptSubmit hook (if not already present)
const userPromptHooks = settings.hooks.UserPromptSubmit ?? [];
const hasUserPromptHook = userPromptHooks.some((h) =>
  h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
);
if (!hasUserPromptHook) {
  userPromptHooks.push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command: `${scriptPath} start`,
      },
    ],
  });
  settings.hooks.UserPromptSubmit = userPromptHooks;
}

// Add Notification hook with idle_prompt matcher (if not already present)
const notificationHooks = settings.hooks.Notification ?? [];
const hasNotificationHook = notificationHooks.some((h) =>
  h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
);
if (!hasNotificationHook) {
  notificationHooks.push({
    matcher: "idle_prompt",
    hooks: [
      {
        type: "command",
        command: `${scriptPath} stop`,
      },
    ],
  });
  settings.hooks.Notification = notificationHooks;
}

// Add SessionEnd hook (if not already present)
const sessionEndHooks = settings.hooks.SessionEnd ?? [];
const hasSessionEndHook = sessionEndHooks.some((h) =>
  h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
);
if (!hasSessionEndHook) {
  sessionEndHooks.push({
    matcher: "",
    hooks: [
      {
        type: "command",
        command: `${scriptPath} end`,
      },
    ],
  });
  settings.hooks.SessionEnd = sessionEndHooks;
}
```

- [ ] **Step 6: Update uninstallHooks() to remove UserPromptSubmit, Notification, and SessionEnd**

In `uninstallHooks()`, after the PreToolUse removal block (after line 158), add:

```typescript
// Remove our hooks from UserPromptSubmit
if (settings.hooks.UserPromptSubmit) {
  settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
    (h) => !h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
  );
  if (settings.hooks.UserPromptSubmit.length === 0) {
    delete settings.hooks.UserPromptSubmit;
  }
}

// Remove our hooks from Notification
if (settings.hooks.Notification) {
  settings.hooks.Notification = settings.hooks.Notification.filter(
    (h) => !h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
  );
  if (settings.hooks.Notification.length === 0) {
    delete settings.hooks.Notification;
  }
}

// Remove our hooks from SessionEnd
if (settings.hooks.SessionEnd) {
  settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(
    (h) => !h.hooks?.some((hh) => hh.command.includes(HOOK_IDENTIFIER))
  );
  if (settings.hooks.SessionEnd.length === 0) {
    delete settings.hooks.SessionEnd;
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx vitest run src/__tests__/hookManager.test.ts`
Expected: ALL tests pass

- [ ] **Step 8: Fix the existing "does not duplicate hooks" test**

The existing test on line 114 only checks Stop and PreToolUse. Update it to include all 5:

```typescript
it("does not duplicate hooks if already installed", async () => {
  mockedReadFile.mockResolvedValue(
    JSON.stringify({
      hooks: {
        Stop: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh stop" }],
          },
        ],
        PreToolUse: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh resume" }],
          },
        ],
        UserPromptSubmit: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh start" }],
          },
        ],
        Notification: [
          {
            matcher: "idle_prompt",
            hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh stop" }],
          },
        ],
        SessionEnd: [
          {
            matcher: "",
            hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh end" }],
          },
        ],
      },
    })
  );
  mockedWriteFile.mockResolvedValue(undefined);

  await hookManager.installHooks();

  const settingsCall = mockedWriteFile.mock.calls.find(
    (call) => call[0]?.toString().includes("settings.json")
  );
  const written = JSON.parse(settingsCall![1] as string);
  expect(written.hooks.Stop).toHaveLength(1);
  expect(written.hooks.PreToolUse).toHaveLength(1);
  expect(written.hooks.UserPromptSubmit).toHaveLength(1);
  expect(written.hooks.Notification).toHaveLength(1);
  expect(written.hooks.SessionEnd).toHaveLength(1);
});
```

- [ ] **Step 9: Run all tests and verify**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx vitest run`
Expected: ALL tests pass

- [ ] **Step 10: Commit**

```bash
git add src/hookManager.ts src/__tests__/hookManager.test.ts
git commit -m "feat: expand hooks to 5 lifecycle events (UserPromptSubmit, PreToolUse, Stop, Notification, SessionEnd)"
```

---

### Task 3: Add hooks-only code path to ClaudeProcessDetector

**Files:**
- Modify: `src/claudeProcessDetector.ts`
- Modify: `src/__tests__/claudeProcessDetector.test.ts`

- [ ] **Step 1: Write failing tests for hooks-only detectSessions**

In `src/__tests__/claudeProcessDetector.test.ts`, add a new describe block after the existing `detectSessions` describe:

```typescript
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
```

- [ ] **Step 2: Write failing tests for hooks-only getStatusForProject**

Add a new describe block:

```typescript
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

  it("returns Waiting when a matching session has a waiting marker", () => {
    const sessions = makeSessions([{ pid: 1, cwd: "/Users/test/project" }]);
    const hookMarkers = new Set(["sess-1"]);
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
    const hookMarkers = new Set(["sess-1"]);
    const result = detector.getStatusForProject("/Users/test/project", sessions, hookMarkers, true);
    expect(result.status).toBe(ClaudeSessionStatus.Waiting);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx vitest run src/__tests__/claudeProcessDetector.test.ts`
Expected: New tests FAIL (detectSessions doesn't accept `hooksInstalled` param yet, getStatusForProject doesn't accept 4th param)

- [ ] **Step 4: Update detectSessions() signature and implementation**

In `src/claudeProcessDetector.ts`, modify the `detectSessions` method:

```typescript
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

  // CPU mode: existing logic unchanged
  const pids = rawSessions.map((s) => s.pid);
  const cpuMap = await this.batchCheckProcesses(pids);

  const childCpuMap = await this.getChildProcessCpu(
    pids.filter((pid) => cpuMap.has(pid))
  );

  const effectiveCpuMap = new Map<number, number>();
  for (const pid of pids) {
    if (!cpuMap.has(pid)) continue;
    const ownCpu = cpuMap.get(pid) ?? 0;
    const childCpu = childCpuMap.get(pid) ?? 0;
    effectiveCpuMap.set(pid, ownCpu + childCpu);
  }

  for (const [pid, cpu] of effectiveCpuMap) {
    const history = this.cpuHistory.get(pid) ?? [];
    history.push(cpu);
    if (history.length > DEBOUNCE_READINGS) {
      history.shift();
    }
    this.cpuHistory.set(pid, history);
  }

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
```

- [ ] **Step 5: Update getStatusForProject() with hooks-only path**

Replace the `getStatusForProject` method:

```typescript
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
    const markers = hookWaitingMarkers ?? new Set<string>();
    const isWaiting = matching.some(
      (s) =>
        markers.has(String(s.pid)) ||
        markers.has(s.sessionId)
    );
    return {
      status: isWaiting ? ClaudeSessionStatus.Waiting : ClaudeSessionStatus.Active,
      sessions: sorted,
    };
  }

  // CPU mode: existing logic unchanged
  const bestCpu = sorted[0].cpuPercent;

  if (bestCpu > this.cpuThreshold) {
    return { status: ClaudeSessionStatus.Active, sessions: sorted };
  }

  if (hookWaitingMarkers && hookWaitingMarkers.size > 0) {
    const isHookConfirmedWaiting = matching.some(
      (s) =>
        hookWaitingMarkers.has(String(s.pid)) ||
        hookWaitingMarkers.has(s.sessionId)
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx vitest run src/__tests__/claudeProcessDetector.test.ts`
Expected: ALL tests pass (old and new)

- [ ] **Step 7: Commit**

```bash
git add src/claudeProcessDetector.ts src/__tests__/claudeProcessDetector.test.ts
git commit -m "feat: add hooks-only code path to ClaudeProcessDetector — skip CPU when hooks installed"
```

---

### Task 4: Update ProjectTreeProvider for hooks mode

**Files:**
- Modify: `src/projectTreeProvider.ts`

- [ ] **Step 1: Add hooksInstalled caching to the class**

Add a `hooksInstalled` field and setter:

```typescript
export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable {
  // ... existing fields ...
  private hooksInstalled = false;

  // ... existing constructor ...

  setHooksInstalled(installed: boolean): void {
    this.hooksInstalled = installed;
  }
```

- [ ] **Step 2: Update getChildren() to pass hooksInstalled**

In the `getChildren()` method, update the `detectSessions` call and the `getStatusForProject` call:

```typescript
// Root level = projects
const projects = this.projectManager.getProjects();
if (projects.length === 0) {
  return [];
}

const sessions = await this.detector.detectSessions(this.hooksInstalled);

// Get hook markers for accurate status detection
const hookWaitingMarkers = await this.hookManager.getWaitingMarkers();

// Clean up stale markers
const alivePids = new Set(sessions.map((s) => s.pid));
const aliveSessionIds = new Set(sessions.map((s) => s.sessionId));
this.hookManager.cleanStaleMarkers(alivePids, aliveSessionIds);

const projectsWithStatus: ProjectWithStatus[] = projects.map((config) => {
  const { status, sessions: matchingSessions } = this.detector.getStatusForProject(
    config.path,
    sessions,
    hookWaitingMarkers,
    this.hooksInstalled
  );
  return {
    type: "project" as const,
    config,
    displayName: config.name ?? path.basename(config.path),
    status,
    sessions: matchingSessions,
    sessionCount: matchingSessions.length,
  };
});
```

- [ ] **Step 3: Update getStatusDescription() to drop CPU% in hooks mode**

Replace the `getStatusDescription` method:

```typescript
private getStatusDescription(project: ProjectWithStatus): string {
  switch (project.status) {
    case ClaudeSessionStatus.Active: {
      const countStr = project.sessionCount > 1 ? ` (${project.sessionCount} sessions)` : "";
      if (this.hooksInstalled) {
        return `Working${countStr}`;
      }
      const cpu = project.sessions[0]?.cpuPercent?.toFixed(0) ?? "?";
      return `Working - CPU: ${cpu}%${countStr}`;
    }
    case ClaudeSessionStatus.Waiting: {
      const countStr = project.sessionCount > 1 ? ` (${project.sessionCount} sessions)` : "";
      return `Needs input${countStr}`;
    }
    case ClaudeSessionStatus.Inactive:
      return "No session";
  }
}
```

- [ ] **Step 4: Update getSessionTreeItem() to drop CPU% in hooks mode and use new color scheme**

Replace the description/icon logic in `getSessionTreeItem()`:

```typescript
private getSessionTreeItem(element: SessionItem): vscode.TreeItem {
  const { session } = element;
  const started = this.timeAgo(session.startedAt);
  const label = `PID ${session.pid}`;

  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

  // In hooks mode, use parent project status. In CPU mode, use CPU threshold.
  const isActive = this.hooksInstalled
    ? session.cpuPercent === -1 // -1 means hooks mode, check parent status
    : session.cpuPercent > 5;

  if (this.hooksInstalled) {
    item.description = `${started}`;
  } else {
    item.description = isActive
      ? `Working (CPU: ${session.cpuPercent.toFixed(0)}%) - ${started}`
      : `Needs input - ${started}`;
  }

  // Yellow = working, Red = needs input (user-centric: red means YOU need to act)
  item.iconPath = new vscode.ThemeIcon(
    isActive ? "pulse" : "watch",
    isActive
      ? new vscode.ThemeColor("terminal.ansiYellow")
      : new vscode.ThemeColor("terminal.ansiRed")
  );

  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**Session** \`${session.sessionId.slice(0, 8)}...\`\n\n`);
  md.appendMarkdown(`- **PID:** ${session.pid}\n`);
  md.appendMarkdown(`- **CWD:** \`${session.cwd}\`\n`);
  if (!this.hooksInstalled) {
    md.appendMarkdown(`- **CPU:** ${session.cpuPercent.toFixed(1)}%\n`);
  }
  md.appendMarkdown(`- **Started:** ${started}\n`);
  md.appendMarkdown(`- **Kind:** ${session.kind}\n`);
  if (session.entrypoint) {
    md.appendMarkdown(`- **Entrypoint:** ${session.entrypoint}\n`);
  }
  item.tooltip = md;

  item.contextValue = "session";

  return item;
}
```

- [ ] **Step 5: Verify compilation**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/projectTreeProvider.ts
git commit -m "feat: update ProjectTreeProvider to use hooks-only display when hooks installed"
```

---

### Task 5: Update StatusBarManager for hooks mode

**Files:**
- Modify: `src/statusBarManager.ts`

- [ ] **Step 1: Add hooksInstalled field and update constructor/update**

Replace the full class:

```typescript
export class StatusBarManager implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem;
  private detector: ClaudeProcessDetector;
  private hookManager: HookManager;
  private pollingTimer: ReturnType<typeof setInterval> | undefined;
  private hooksInstalled = false;

  constructor(detector: ClaudeProcessDetector, hookManager: HookManager) {
    this.detector = detector;
    this.hookManager = hookManager;
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBarItem.command = "claudeSessionsProjects.focus";
    this.statusBarItem.name = "Claude Sessions";
  }

  setHooksInstalled(installed: boolean): void {
    this.hooksInstalled = installed;
  }

  async update(): Promise<void> {
    const showStatusBar = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<boolean>("showStatusBar", true);

    if (!showStatusBar) {
      this.statusBarItem.hide();
      return;
    }

    const sessions = await this.detector.detectSessions(this.hooksInstalled);
    const totalSessions = sessions.length;

    if (totalSessions === 0) {
      this.statusBarItem.text = "$(terminal) Claude: 0";
      this.statusBarItem.tooltip = "No active Claude sessions";
      this.statusBarItem.color = undefined;
    } else if (this.hooksInstalled) {
      // Hooks mode: use markers to determine active vs waiting
      const markers = await this.hookManager.getWaitingMarkers();
      const waitingCount = sessions.filter(
        (s) => markers.has(String(s.pid)) || markers.has(s.sessionId)
      ).length;
      const activeCount = totalSessions - waitingCount;

      if (activeCount > 0) {
        this.statusBarItem.text = `$(pulse) Claude: ${totalSessions} working`;
        this.statusBarItem.tooltip = `${activeCount} working, ${waitingCount} need input`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiYellow");
      } else {
        this.statusBarItem.text = `$(watch) Claude: ${totalSessions} need input`;
        this.statusBarItem.tooltip = `${totalSessions} session(s) need your input`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiRed");
      }
    } else {
      // CPU mode: existing logic (yellow = working, red = needs input)
      const activeSessions = this.detector.getActiveCount(sessions);
      if (activeSessions > 0) {
        this.statusBarItem.text = `$(pulse) Claude: ${totalSessions} working`;
        this.statusBarItem.tooltip = `${activeSessions} working, ${totalSessions - activeSessions} need input`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiYellow");
      } else {
        this.statusBarItem.text = `$(watch) Claude: ${totalSessions} need input`;
        this.statusBarItem.tooltip = `${totalSessions} session(s) need your input`;
        this.statusBarItem.color = new vscode.ThemeColor("terminal.ansiRed");
      }
    }

    this.statusBarItem.show();
  }

  startPolling(): void {
    this.stopPolling();
    this.update();

    const interval = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<number>("pollingInterval", DEFAULT_POLLING_INTERVAL);

    this.pollingTimer = setInterval(() => this.update(), interval);
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  dispose(): void {
    this.stopPolling();
    this.statusBarItem.dispose();
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/statusBarManager.ts
git commit -m "feat: update StatusBarManager to use marker-based counts in hooks mode"
```

---

### Task 6: Wire everything together in extension.ts

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Import HOOKS_POLLING_INTERVAL**

Update the import line:

```typescript
import { CONFIG_SECTION, CPU_ACTIVE_THRESHOLD, CLAUDE_SESSIONS_DIR, HOOKS_POLLING_INTERVAL } from "./constants";
```

- [ ] **Step 2: Add hooks state caching and propagation**

In the `activate()` function, after creating the components (after line 116), add hooks state management:

```typescript
// Cache hooks state and propagate to components
let hooksInstalled = false;
const updateHooksState = async () => {
  const installed = await hookManager.isInstalled();
  if (installed !== hooksInstalled) {
    hooksInstalled = installed;
    treeProvider.setHooksInstalled(installed);
    statusBar.setHooksInstalled(installed);

    // Restart polling with appropriate interval
    treeProvider.stopPolling();
    treeProvider.startPolling();
    statusBar.stopPolling();
    statusBar.startPolling();
  }
};

// Initial check
updateHooksState();
```

- [ ] **Step 3: Update the polling interval to respect hooks mode**

In `projectTreeProvider.ts`, update `startPolling()` to accept an optional interval override. Actually, it's simpler to have the tree provider and status bar read the hooks state themselves. Instead, let's update `extension.ts` to pass the interval.

Actually, the cleanest approach: update `startPolling` in both `ProjectTreeProvider` and `StatusBarManager` to accept an optional `intervalOverride`:

In `src/projectTreeProvider.ts`, update `startPolling`:

```typescript
startPolling(intervalOverride?: number): void {
  this.stopPolling();
  const interval = intervalOverride ?? vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>("pollingInterval", DEFAULT_POLLING_INTERVAL);

  this.pollingTimer = setInterval(() => this.refresh(), interval);
}
```

In `src/statusBarManager.ts`, update `startPolling`:

```typescript
startPolling(intervalOverride?: number): void {
  this.stopPolling();
  this.update();

  const interval = intervalOverride ?? vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .get<number>("pollingInterval", DEFAULT_POLLING_INTERVAL);

  this.pollingTimer = setInterval(() => this.update(), interval);
}
```

Then in `extension.ts`, update `updateHooksState`:

```typescript
const updateHooksState = async () => {
  const installed = await hookManager.isInstalled();
  if (installed !== hooksInstalled) {
    hooksInstalled = installed;
    treeProvider.setHooksInstalled(installed);
    statusBar.setHooksInstalled(installed);

    // Restart polling with appropriate interval
    const interval = installed ? HOOKS_POLLING_INTERVAL : undefined;
    treeProvider.stopPolling();
    treeProvider.startPolling(interval);
    statusBar.stopPolling();
    statusBar.startPolling(interval);
  }
};
```

- [ ] **Step 4: Update the updateBadge function to pass hooksInstalled**

```typescript
const updateBadge = async () => {
  const sessions = await detector.detectSessions(hooksInstalled);
  const count = sessions.length;
  treeView.badge = count > 0 ? { value: count, tooltip: `${count} Claude session(s)` } : undefined;
};
```

- [ ] **Step 5: Refresh hooks state on file watcher events**

In the file watcher `debouncedRefresh` callback, add hooks state refresh:

```typescript
const debouncedRefresh = () => {
  if (refreshDebounceTimer) {
    clearTimeout(refreshDebounceTimer);
  }
  refreshDebounceTimer = setTimeout(() => {
    updateHooksState();
    treeProvider.refresh();
    statusBar.update();
    updateBadge();
  }, 300);
};
```

- [ ] **Step 6: Update the config change handler to respect hooks interval**

In the `onDidChangeConfiguration` handler, update the polling restart to use hooks-aware interval:

```typescript
vscode.workspace.onDidChangeConfiguration((e) => {
  if (e.affectsConfiguration(CONFIG_SECTION)) {
    const newThreshold = vscode.workspace
      .getConfiguration(CONFIG_SECTION)
      .get<number>("cpuThreshold", CPU_ACTIVE_THRESHOLD);
    detector.setCpuThreshold(newThreshold);

    const interval = hooksInstalled ? HOOKS_POLLING_INTERVAL : undefined;
    treeProvider.stopPolling();
    treeProvider.startPolling(interval);

    statusBar.stopPolling();
    statusBar.startPolling(interval);

    treeProvider.refresh();
  }
})
```

- [ ] **Step 7: Update the hook suggestion message**

Update the suggestion message (around line 305) to mention the new hooks-first behavior:

```typescript
vscode.window
  .showInformationMessage(
    "Install Claude CLI hooks for accurate session status detection? " +
    "(Eliminates flickering — uses lifecycle events instead of CPU monitoring)",
    "Install Hooks",
    "Not Now"
  )
```

- [ ] **Step 8: Verify compilation**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 9: Run all tests**

Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npx vitest run`
Expected: ALL tests pass

- [ ] **Step 10: Commit**

```bash
git add src/extension.ts src/projectTreeProvider.ts src/statusBarManager.ts
git commit -m "feat: wire hooks-first detection — cache state, adjust polling, propagate to all components"
```

---

### Task 7: Bump version, update hook suggestion key, and publish

**Files:**
- Modify: `package.json`
- Modify: `src/extension.ts`

- [ ] **Step 1: Bump version in package.json**

Change version from `"0.2.3"` to `"0.3.0"` (minor bump — new feature).

- [ ] **Step 2: Update hook suggestion key**

In `src/extension.ts`, update the `hasShownKey` constant:

```typescript
const hasShownKey = "hookSuggestionShown_v0.3.0";
```

This ensures users who previously dismissed the suggestion see it again with the improved hooks.

- [ ] **Step 3: Commit and publish via tag**

```bash
git add package.json src/extension.ts
git commit -m "chore: bump version to 0.3.0 for hooks-first detection release"
git tag v0.3.0
git push origin main --tags
```

The GitHub Actions workflow (`.github/workflows/publish.yml`) will automatically run tests and publish to the VS Code Marketplace on tag push.

---

### Task 8: Verify publish and manual integration test

- [ ] **Step 1: Verify the GitHub Actions publish succeeded**

Run: `gh run list --workflow "Publish Extension" --limit 1`
Expected: The v0.3.0 run shows status "completed" with conclusion "success".

- [ ] **Step 2: Install the published extension**

Install from marketplace or build locally:
Run: `cd /Users/cristianceamatu/wd/claude-sessions-ext && npm run compile`
Expected: Build succeeds

- [ ] **Step 3: Install hooks via the command palette**

In VS Code: `Cmd+Shift+P` → "Claude Sessions: Install Status Hooks"
Expected: Success message, `~/.claude/settings.json` now has 5 hook entries (Stop, PreToolUse, UserPromptSubmit, Notification, SessionEnd)

- [ ] **Step 4: Verify hook script**

Run: `cat ~/.claude/vscode-session-manager-hook.sh`
Expected: Script shows 4 case actions: `stop`, `resume|start`, `end`

- [ ] **Step 5: Start a Claude session in a tracked project and observe**

- Status should show **Working** (yellow) when Claude is busy
- Status should show **Needs input** (red) when Claude stops and waits for your input
- **No flickering** between yellow and red during active work
- No CPU% shown in the sidebar descriptions

- [ ] **Step 6: Verify session end cleanup**

End the Claude session. Marker file should be cleaned up. Status should return to Inactive.
