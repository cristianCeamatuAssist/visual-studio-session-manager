# Session Metadata Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare `PID <n>` session row in the Claude Code Pulse tree with the session's chat title, show context-window usage as a percentage, and show the git branch once on the parent project row.

**Architecture:** A pure parser (`sessionMetadata.ts`) extracts title / context% / branch from a Claude transcript string. An I/O layer (`transcriptReader.ts`) locates the transcript via `~/.claude/projects/*/<sessionId>.jsonl`, caches by size+mtime, and uses a cheap tail read for incremental refreshes. A small cached git helper (`gitBranch.ts`) resolves the branch for idle projects. The `ProjectTreeProvider` enriches each session with this metadata and renders it; both new dependencies are injected with production defaults so no other wiring changes.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, Node `fs/promises`, `git` CLI.

---

## File Structure

- Modify: `src/types.ts` — add `title`, `contextPercent`, `gitBranch` to `ClaudeSession`; add `branch` to `WorkspaceWithStatus`.
- Create: `src/sessionMetadata.ts` — pure transcript parsing (no `vscode`/`fs`), unit-testable.
- Create: `src/transcriptReader.ts` — locate + read + cache transcript metadata.
- Create: `src/gitBranch.ts` — cached `git rev-parse` branch lookup.
- Modify: `src/projectTreeProvider.ts` — inject deps, enrich sessions, compute project branch, render.
- Test: `src/__tests__/sessionMetadata.test.ts` (create)
- Test: `src/__tests__/transcriptReader.test.ts` (create)
- Test: `src/__tests__/gitBranch.test.ts` (create)
- Test: `src/__tests__/projectTreeProvider.test.ts` (modify)

No change to `src/extension.ts`: the provider's new constructor params default to a shared `TranscriptReader` and `getGitBranch`, so production wiring is automatic.

---

### Task 1: Add metadata fields to the types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Extend `ClaudeSession`**

In `src/types.ts`, replace the `ClaudeSession` interface with:

```ts
export interface ClaudeSession {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
  kind: string;
  entrypoint?: string;
  cpuPercent: number;
  /** Chat title from the transcript (custom-title → ai-title → first prompt). */
  title?: string;
  /** Context-window usage percentage (0–100+), undefined when unknown. */
  contextPercent?: number;
  /** Git branch recorded in the transcript. */
  gitBranch?: string;
}
```

- [ ] **Step 2: Add `branch` to `WorkspaceWithStatus`**

In the `WorkspaceWithStatus` interface, add this field after `worktrees`:

```ts
  /** Git branch for this window (from its sessions, or resolved via git). */
  branch?: string;
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run compile
```

Expected: PASS (all new fields are optional; no call site breaks).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add session metadata fields to types"
```

---

### Task 2: Build the pure transcript metadata parser

**Files:**
- Create: `src/sessionMetadata.ts`
- Create: `src/__tests__/sessionMetadata.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/sessionMetadata.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSessionMetadata, parseTailMetadata, isOneMillionModel } from "../sessionMetadata";

function jsonl(...records: object[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n");
}

describe("isOneMillionModel", () => {
  it("detects 1M markers and ignores normal ids", () => {
    expect(isOneMillionModel("claude-opus-4-8[1m]")).toBe(true);
    expect(isOneMillionModel("claude-sonnet-4-6-1m")).toBe(true);
    expect(isOneMillionModel("claude-opus-4-8")).toBe(false);
    expect(isOneMillionModel(undefined)).toBe(false);
  });
});

describe("parseSessionMetadata", () => {
  it("prefers custom-title over ai-title and prompt", () => {
    const content = jsonl(
      { type: "user", message: { content: "do the thing" } },
      { type: "ai-title", aiTitle: "Auto generated title" },
      { type: "custom-title", customTitle: "My renamed chat" },
    );
    expect(parseSessionMetadata(content).title).toBe("My renamed chat");
  });

  it("falls back to ai-title when no custom-title", () => {
    const content = jsonl({ type: "ai-title", aiTitle: "Auto generated title" });
    expect(parseSessionMetadata(content).title).toBe("Auto generated title");
  });

  it("falls back to first non-noise user prompt and truncates", () => {
    const content = jsonl(
      { type: "user", message: { content: "<local-command-caveat>noise" } },
      { type: "user", message: { content: "/slash command" } },
      { type: "user", message: { content: "Refactor the authentication layer into smaller modules please" } },
    );
    const title = parseSessionMetadata(content).title!;
    expect(title.startsWith("Refactor the authentication")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(40);
    expect(title.endsWith("…")).toBe(true);
  });

  it("returns undefined title when nothing usable exists", () => {
    const content = jsonl({ type: "system", message: { content: "boot" } });
    expect(parseSessionMetadata(content).title).toBeUndefined();
  });

  it("uses the last gitBranch occurrence", () => {
    const content = jsonl(
      { type: "user", gitBranch: "main", message: { content: "x" } },
      { type: "assistant", gitBranch: "feat/new", message: { content: "y" } },
    );
    expect(parseSessionMetadata(content).gitBranch).toBe("feat/new");
  });

  it("computes context percent against the 200k window", () => {
    const content = jsonl({
      type: "assistant",
      message: { model: "claude-opus-4-8", usage: { input_tokens: 1, cache_read_input_tokens: 38601, cache_creation_input_tokens: 3476 } },
    });
    // (1 + 38601 + 3476) / 200000 ≈ 21%
    expect(parseSessionMetadata(content).contextPercent).toBe(21);
  });

  it("switches to the 1M window when usage exceeds 200k", () => {
    const content = jsonl({
      type: "assistant",
      message: { model: "claude-opus-4-8", usage: { input_tokens: 0, cache_read_input_tokens: 335911, cache_creation_input_tokens: 0 } },
    });
    // 335911 / 1_000_000 ≈ 34%
    expect(parseSessionMetadata(content).contextPercent).toBe(34);
  });

  it("omits context percent when there is no usage", () => {
    const content = jsonl({ type: "user", message: { content: "hi" } });
    expect(parseSessionMetadata(content).contextPercent).toBeUndefined();
  });

  it("skips corrupt lines without throwing", () => {
    const content = ["{ broken", JSON.stringify({ type: "ai-title", aiTitle: "Survived" }), ""].join("\n");
    expect(parseSessionMetadata(content).title).toBe("Survived");
  });
});

describe("parseTailMetadata", () => {
  it("returns custom-title, branch and percent but not ai-title/prompt", () => {
    const content = jsonl(
      { type: "ai-title", aiTitle: "should be ignored in tail" },
      { type: "user", message: { content: "should be ignored in tail" } },
      { type: "custom-title", customTitle: "renamed in tail" },
      { type: "assistant", gitBranch: "feat/tail", message: { model: "claude-opus-4-8", usage: { input_tokens: 100000 } } },
    );
    const tail = parseTailMetadata(content);
    expect(tail.customTitle).toBe("renamed in tail");
    expect(tail.gitBranch).toBe("feat/tail");
    expect(tail.contextPercent).toBe(50);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run src/__tests__/sessionMetadata.test.ts
```

Expected: FAIL with `Failed to resolve import "../sessionMetadata"`.

- [ ] **Step 3: Implement the parser**

Create `src/sessionMetadata.ts`:

```ts
export interface SessionMetadata {
  title?: string;
  contextPercent?: number;
  gitBranch?: string;
}

export interface TailMetadata {
  customTitle?: string;
  contextPercent?: number;
  gitBranch?: string;
}

const DEFAULT_WINDOW = 200_000;
const ONE_MILLION_WINDOW = 1_000_000;
const TITLE_MAX_LENGTH = 40;

export function isOneMillionModel(modelId: string | undefined): boolean {
  if (!modelId) return false;
  return /\[1m\]/i.test(modelId) || /-1m($|[^a-z0-9])/i.test(modelId);
}

interface Usage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

function usedTokens(usage: Usage): number {
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0)
  );
}

function contextPercentFrom(usage: Usage | undefined, model: string | undefined): number | undefined {
  if (!usage) return undefined;
  const used = usedTokens(usage);
  if (used <= 0) return undefined;
  const window =
    used > DEFAULT_WINDOW || isOneMillionModel(model) ? ONE_MILLION_WINDOW : DEFAULT_WINDOW;
  return Math.round((used / window) * 100);
}

function truncateTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= TITLE_MAX_LENGTH) return clean;
  return clean.slice(0, TITLE_MAX_LENGTH - 1).trimEnd() + "…";
}

function userText(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part && typeof part === "object" && (part as { type?: string }).type === "text") {
        const text = (part as { text?: unknown }).text;
        if (typeof text === "string") return text;
      }
    }
  }
  return undefined;
}

function isPromptNoise(text: string): boolean {
  const t = text.trim();
  return t.length === 0 || t.startsWith("<") || t.startsWith("/") || t.includes("local-command");
}

function parseLine(line: string): Record<string, unknown> | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function messageOf(rec: Record<string, unknown>): { usage?: Usage; model?: string } | undefined {
  const msg = rec.message;
  if (!msg || typeof msg !== "object") return undefined;
  return msg as { usage?: Usage; model?: string };
}

export function parseSessionMetadata(content: string): SessionMetadata {
  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  let firstPrompt: string | undefined;
  let gitBranch: string | undefined;
  let lastUsage: Usage | undefined;
  let lastModel: string | undefined;

  for (const line of content.split("\n")) {
    const rec = parseLine(line);
    if (!rec) continue;

    const type = rec.type;
    if (type === "custom-title" && typeof rec.customTitle === "string") {
      customTitle = rec.customTitle;
    } else if (type === "ai-title" && typeof rec.aiTitle === "string") {
      aiTitle = rec.aiTitle;
    }

    if (typeof rec.gitBranch === "string" && rec.gitBranch.length > 0) {
      gitBranch = rec.gitBranch;
    }

    const msg = messageOf(rec);
    if (msg?.usage) lastUsage = msg.usage;
    if (typeof msg?.model === "string") lastModel = msg.model;

    if (firstPrompt === undefined && type === "user") {
      const text = userText(rec.message);
      if (text && !isPromptNoise(text)) firstPrompt = text;
    }
  }

  const rawTitle = customTitle ?? aiTitle ?? firstPrompt;
  return {
    title: rawTitle ? truncateTitle(rawTitle) : undefined,
    contextPercent: contextPercentFrom(lastUsage, lastModel),
    gitBranch,
  };
}

export function parseTailMetadata(content: string): TailMetadata {
  let customTitle: string | undefined;
  let gitBranch: string | undefined;
  let lastUsage: Usage | undefined;
  let lastModel: string | undefined;

  for (const line of content.split("\n")) {
    const rec = parseLine(line);
    if (!rec) continue;

    if (rec.type === "custom-title" && typeof rec.customTitle === "string") {
      customTitle = rec.customTitle;
    }
    if (typeof rec.gitBranch === "string" && rec.gitBranch.length > 0) {
      gitBranch = rec.gitBranch;
    }
    const msg = messageOf(rec);
    if (msg?.usage) lastUsage = msg.usage;
    if (typeof msg?.model === "string") lastModel = msg.model;
  }

  return {
    customTitle: customTitle ? truncateTitle(customTitle) : undefined,
    contextPercent: contextPercentFrom(lastUsage, lastModel),
    gitBranch,
  };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npx vitest run src/__tests__/sessionMetadata.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sessionMetadata.ts src/__tests__/sessionMetadata.test.ts
git commit -m "feat: parse chat title, context percent and branch from transcript"
```

---

### Task 3: Build the transcript reader (I/O + caching)

**Files:**
- Create: `src/transcriptReader.ts`
- Create: `src/__tests__/transcriptReader.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/transcriptReader.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  access: vi.fn(),
  stat: vi.fn(),
  readFile: vi.fn(),
  open: vi.fn(),
}));

import * as fs from "fs/promises";
import { TranscriptReader } from "../transcriptReader";

const mockedReaddir = vi.mocked(fs.readdir);
const mockedAccess = vi.mocked(fs.access);
const mockedStat = vi.mocked(fs.stat);
const mockedReadFile = vi.mocked(fs.readFile);
const mockedOpen = vi.mocked(fs.open);

function aiTitleLine(title: string): string {
  return JSON.stringify({ type: "ai-title", aiTitle: title });
}

describe("TranscriptReader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns undefined when the session has no transcript", async () => {
    mockedReaddir.mockResolvedValue(["proj-a"] as unknown as ReturnType<typeof fs.readdir>);
    mockedAccess.mockRejectedValue(new Error("ENOENT"));

    const reader = new TranscriptReader();
    expect(await reader.readSessionMetadata("missing")).toBeUndefined();
  });

  it("locates the transcript by glob and parses metadata on first read", async () => {
    mockedReaddir.mockResolvedValue(["proj-a", "proj-b"] as unknown as ReturnType<typeof fs.readdir>);
    mockedAccess.mockImplementation(async (p) => {
      if (String(p).includes("proj-b")) return undefined as never;
      throw new Error("ENOENT");
    });
    mockedStat.mockResolvedValue({ size: 100, mtimeMs: 5 } as never);
    mockedReadFile.mockResolvedValue(aiTitleLine("Found it") as never);

    const reader = new TranscriptReader();
    const meta = await reader.readSessionMetadata("sid");

    expect(meta?.title).toBe("Found it");
    expect(String(mockedReadFile.mock.calls[0][0])).toContain("proj-b");
  });

  it("returns cached metadata without re-reading when size+mtime are unchanged", async () => {
    mockedReaddir.mockResolvedValue(["proj"] as unknown as ReturnType<typeof fs.readdir>);
    mockedAccess.mockResolvedValue(undefined as never);
    mockedStat.mockResolvedValue({ size: 100, mtimeMs: 5 } as never);
    mockedReadFile.mockResolvedValue(aiTitleLine("Cached") as never);

    const reader = new TranscriptReader();
    await reader.readSessionMetadata("sid");
    await reader.readSessionMetadata("sid");

    expect(mockedReadFile).toHaveBeenCalledTimes(1);
  });

  it("does a tail read keeping the cached title when the file grows", async () => {
    mockedReaddir.mockResolvedValue(["proj"] as unknown as ReturnType<typeof fs.readdir>);
    mockedAccess.mockResolvedValue(undefined as never);
    mockedReadFile.mockResolvedValue(aiTitleLine("Original title") as never);

    const tail = JSON.stringify({
      type: "assistant",
      gitBranch: "feat/tail",
      message: { model: "claude-opus-4-8", usage: { input_tokens: 100000 } },
    });
    const tailBuf = Buffer.from(tail, "utf-8");
    mockedOpen.mockResolvedValue({
      read: vi.fn().mockImplementation((b: Buffer) => {
        tailBuf.copy(b, 0, 0, tailBuf.length);
        return Promise.resolve({ bytesRead: tailBuf.length });
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as never);

    const reader = new TranscriptReader();
    mockedStat.mockResolvedValueOnce({ size: tailBuf.length, mtimeMs: 5 } as never);
    await reader.readSessionMetadata("sid");

    mockedStat.mockResolvedValueOnce({ size: tailBuf.length, mtimeMs: 9 } as never);
    const meta = await reader.readSessionMetadata("sid");

    expect(meta?.title).toBe("Original title"); // kept from cache
    expect(meta?.gitBranch).toBe("feat/tail"); // refreshed from tail
    expect(meta?.contextPercent).toBe(50);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run src/__tests__/transcriptReader.test.ts
```

Expected: FAIL with `Failed to resolve import "../transcriptReader"`.

- [ ] **Step 3: Implement the reader**

Create `src/transcriptReader.ts`:

```ts
import * as fs from "fs/promises";
import * as path from "path";
import { CLAUDE_PROJECTS_DIR } from "./constants";
import {
  SessionMetadata,
  parseSessionMetadata,
  parseTailMetadata,
} from "./sessionMetadata";

const TAIL_BYTES = 64 * 1024;

interface CacheEntry {
  size: number;
  mtimeMs: number;
  metadata: SessionMetadata;
}

export class TranscriptReader {
  private pathCache = new Map<string, string>();
  private metaCache = new Map<string, CacheEntry>();

  async readSessionMetadata(sessionId: string): Promise<SessionMetadata | undefined> {
    const filePath = await this.findTranscriptPath(sessionId);
    if (!filePath) return undefined;

    let stat: { size: number; mtimeMs: number };
    try {
      stat = await fs.stat(filePath);
    } catch {
      return undefined;
    }

    const cached = this.metaCache.get(filePath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      return cached.metadata;
    }

    // First sighting of this file: full read to establish the title.
    if (!cached) {
      const metadata = await this.readFull(filePath);
      if (metadata) {
        this.metaCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, metadata });
      }
      return metadata;
    }

    // Known file that changed: cheap tail read; keep cached title unless renamed.
    const tail = await this.readTail(filePath, stat.size);
    const metadata: SessionMetadata = {
      title: tail?.customTitle ?? cached.metadata.title,
      contextPercent: tail?.contextPercent ?? cached.metadata.contextPercent,
      gitBranch: tail?.gitBranch ?? cached.metadata.gitBranch,
    };
    this.metaCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, metadata });
    return metadata;
  }

  private async readFull(filePath: string): Promise<SessionMetadata | undefined> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return parseSessionMetadata(content);
    } catch {
      return undefined;
    }
  }

  private async readTail(filePath: string, size: number) {
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(filePath, "r");
      const start = Math.max(0, size - TAIL_BYTES);
      const length = size - start;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      return parseTailMetadata(buffer.toString("utf-8"));
    } catch {
      return undefined;
    } finally {
      await handle?.close();
    }
  }

  private async findTranscriptPath(sessionId: string): Promise<string | undefined> {
    const cached = this.pathCache.get(sessionId);
    if (cached) return cached;

    let dirs: string[];
    try {
      dirs = await fs.readdir(CLAUDE_PROJECTS_DIR);
    } catch {
      return undefined;
    }

    for (const dir of dirs) {
      const candidate = path.join(CLAUDE_PROJECTS_DIR, dir, `${sessionId}.jsonl`);
      try {
        await fs.access(candidate);
        this.pathCache.set(sessionId, candidate);
        return candidate;
      } catch {
        // not in this project dir
      }
    }
    return undefined;
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npx vitest run src/__tests__/transcriptReader.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/transcriptReader.ts src/__tests__/transcriptReader.test.ts
git commit -m "feat: read and cache session metadata from transcripts"
```

---

### Task 4: Build the cached git branch helper

**Files:**
- Create: `src/gitBranch.ts`
- Create: `src/__tests__/gitBranch.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/gitBranch.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({ exec: vi.fn() }));

import { exec } from "child_process";
import { getGitBranch } from "../gitBranch";

const mockedExec = vi.mocked(exec);

function execReturns(stdout: string, err: Error | null = null): void {
  mockedExec.mockImplementation(((_cmd: string, cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
    cb(err, { stdout, stderr: "" });
    return undefined as never;
  }) as never);
}

describe("getGitBranch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the trimmed branch name", async () => {
    execReturns("feat/voyager\n");
    expect(await getGitBranch("/repo-a", 1000)).toBe("feat/voyager");
  });

  it("returns undefined for detached HEAD", async () => {
    execReturns("HEAD\n");
    expect(await getGitBranch("/repo-b", 1000)).toBeUndefined();
  });

  it("returns undefined when git fails", async () => {
    execReturns("", new Error("not a repo"));
    expect(await getGitBranch("/repo-c", 1000)).toBeUndefined();
  });

  it("caches within the TTL and re-runs after it expires", async () => {
    execReturns("main\n");
    await getGitBranch("/repo-d", 1000);
    await getGitBranch("/repo-d", 1500); // within TTL → cached
    expect(mockedExec).toHaveBeenCalledTimes(1);

    await getGitBranch("/repo-d", 1000 + 60_000); // past TTL → re-run
    expect(mockedExec).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run src/__tests__/gitBranch.test.ts
```

Expected: FAIL with `Failed to resolve import "../gitBranch"`.

- [ ] **Step 3: Implement the helper**

Create `src/gitBranch.ts`:

```ts
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const TTL_MS = 30_000;
const cache = new Map<string, { value: string | undefined; at: number }>();

export async function getGitBranch(
  folder: string,
  now: number = Date.now()
): Promise<string | undefined> {
  const cached = cache.get(folder);
  if (cached && now - cached.at < TTL_MS) {
    return cached.value;
  }

  let value: string | undefined;
  try {
    const { stdout } = await execAsync(`git -C "${folder}" rev-parse --abbrev-ref HEAD`);
    const branch = stdout.trim();
    value = branch && branch !== "HEAD" ? branch : undefined;
  } catch {
    value = undefined;
  }

  cache.set(folder, { value, at: now });
  return value;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run:

```bash
npx vitest run src/__tests__/gitBranch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gitBranch.ts src/__tests__/gitBranch.test.ts
git commit -m "feat: cached git branch resolver"
```

---

### Task 5: Enrich and render session metadata in the tree provider

**Files:**
- Modify: `src/projectTreeProvider.ts`
- Modify: `src/__tests__/projectTreeProvider.test.ts`

- [ ] **Step 1: Update test setup and add failing tests**

In `src/__tests__/projectTreeProvider.test.ts`, add two mock factories next to `createMockWorktreeResolver`:

```ts
function createMockReadMetadata() {
  return vi.fn().mockResolvedValue(undefined);
}

function createMockGetBranch() {
  return vi.fn().mockResolvedValue(undefined);
}
```

Declare them with the other mocks:

```ts
  let mockReadMetadata: ReturnType<typeof createMockReadMetadata>;
  let mockGetBranch: ReturnType<typeof createMockGetBranch>;
```

In `beforeEach`, create them and pass them as the 7th and 8th constructor arguments:

```ts
    mockReadMetadata = createMockReadMetadata();
    mockGetBranch = createMockGetBranch();
    provider = new ProjectTreeProvider(
      mockDetector as never,
      mockRegistry as never,
      mockHookManager as never,
      "/ext/path",
      mockGlobalState as never,
      mockResolveWorktree,
      mockReadMetadata,
      mockGetBranch
    );
```

Append a new describe block:

```ts
describe("session metadata rendering", () => {
  it("labels a session by its chat title and shows context %", async () => {
    mockRegistry.getActiveWorkspaces.mockResolvedValue([makeEntry({ folder: "/p", name: "p" })]);
    const session = { pid: 7, sessionId: "abc", cwd: "/p", startedAt: Date.now(), kind: "cli", cpuPercent: 50 };
    mockDetector.detectSessions.mockResolvedValue([session]);
    mockDetector.getStatusForWorkspace.mockReturnValue({ status: ClaudeSessionStatus.Active, sessions: [session] });
    mockReadMetadata.mockResolvedValue({ title: "Fix voyager tests", contextPercent: 45, gitBranch: "feat/x" });

    const roots = await provider.getChildren();
    const children = await provider.getChildren(roots[0]);
    const sessionNode = children.find((c) => c.type === "session")!;
    const item = provider.getTreeItem(sessionNode);

    expect((item as vscode.TreeItem).label).toBe("Fix voyager tests");
    expect(String((item as vscode.TreeItem).description)).toContain("45% ·");
  });

  it("falls back to PID label when there is no title", async () => {
    mockRegistry.getActiveWorkspaces.mockResolvedValue([makeEntry({ folder: "/p", name: "p" })]);
    const session = { pid: 7, sessionId: "abc", cwd: "/p", startedAt: Date.now(), kind: "cli", cpuPercent: 50 };
    mockDetector.detectSessions.mockResolvedValue([session]);
    mockDetector.getStatusForWorkspace.mockReturnValue({ status: ClaudeSessionStatus.Active, sessions: [session] });
    mockReadMetadata.mockResolvedValue(undefined);

    const roots = await provider.getChildren();
    const children = await provider.getChildren(roots[0]);
    const item = provider.getTreeItem(children.find((c) => c.type === "session")!);

    expect((item as vscode.TreeItem).label).toBe("PID 7");
  });

  it("shows the git branch on the project row from its sessions", async () => {
    mockRegistry.getActiveWorkspaces.mockResolvedValue([makeEntry({ folder: "/p", name: "p" })]);
    const session = { pid: 7, sessionId: "abc", cwd: "/p", startedAt: Date.now(), kind: "cli", cpuPercent: 1 };
    mockDetector.detectSessions.mockResolvedValue([session]);
    mockDetector.getStatusForWorkspace.mockReturnValue({ status: ClaudeSessionStatus.Active, sessions: [session] });
    mockReadMetadata.mockResolvedValue({ gitBranch: "feat/voyager" });

    const roots = await provider.getChildren();
    const item = provider.getTreeItem(roots[0]);

    expect(String((item as vscode.TreeItem).description)).toContain("feat/voyager");
    expect(mockGetBranch).not.toHaveBeenCalled();
  });

  it("falls back to git for branch when the project has no sessions", async () => {
    mockRegistry.getActiveWorkspaces.mockResolvedValue([makeEntry({ folder: "/idle", name: "idle" })]);
    mockDetector.detectSessions.mockResolvedValue([]);
    mockDetector.getStatusForWorkspace.mockReturnValue({ status: ClaudeSessionStatus.Inactive, sessions: [] });
    mockGetBranch.mockResolvedValue("main");

    const roots = await provider.getChildren();
    const item = provider.getTreeItem(roots[0]);

    expect(mockGetBranch).toHaveBeenCalledWith("/idle");
    expect(String((item as vscode.TreeItem).description)).toContain("main");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npx vitest run src/__tests__/projectTreeProvider.test.ts
```

Expected: FAIL — the constructor does not accept a 7th/8th argument and metadata is not rendered.

- [ ] **Step 3: Add imports and injected dependencies**

In `src/projectTreeProvider.ts`, add these imports after the existing imports:

```ts
import { getGitBranch } from "./gitBranch";
import { TranscriptReader } from "./transcriptReader";
import { SessionMetadata } from "./sessionMetadata";
```

Add a module-level shared reader right after the imports (before the class):

```ts
const sharedTranscriptReader = new TranscriptReader();
```

Add two fields after `private worktreeInfoCache = new Map<string, WorktreeInfo>();`:

```ts
  private readSessionMetadataFn: (sessionId: string) => Promise<SessionMetadata | undefined>;
  private getBranchFn: (folder: string) => Promise<string | undefined>;
```

Extend the constructor signature (add two params after `resolveWorktreeFn`):

```ts
    resolveWorktreeFn: (folder: string) => Promise<WorktreeInfo> = resolveWorktree,
    readSessionMetadataFn: (sessionId: string) => Promise<SessionMetadata | undefined> =
      (sessionId) => sharedTranscriptReader.readSessionMetadata(sessionId),
    getBranchFn: (folder: string) => Promise<string | undefined> = getGitBranch
```

And assign them in the constructor body after `this.resolveWorktreeFn = resolveWorktreeFn;`:

```ts
    this.readSessionMetadataFn = readSessionMetadataFn;
    this.getBranchFn = getBranchFn;
```

- [ ] **Step 4: Enrich sessions and compute project branch in `getChildren`**

In `getChildren`, immediately after:

```ts
    const sessions = await this.detector.detectSessions(this.hooksInstalled);
```

add:

```ts
    // Enrich sessions with transcript metadata (title, context %, git branch).
    await Promise.all(
      sessions.map(async (session) => {
        const meta = await this.readSessionMetadataFn(session.sessionId);
        if (meta) {
          session.title = meta.title;
          session.contextPercent = meta.contextPercent;
          session.gitBranch = meta.gitBranch;
        }
      })
    );
```

In the `workspacesWithStatus` object literal, add `branch: undefined,` right after `worktreeOf: undefined,`:

```ts
        worktreeOf: undefined,
        branch: undefined,
        worktrees: [],
```

Immediately after the `const workspacesWithStatus: WorkspaceWithStatus[] = workspaces.map(...)` block (i.e. before `const byFolder = new Map<...>();`), add:

```ts
    // Branch shown on the project row: prefer a branch reported by its sessions,
    // otherwise resolve it from git for idle projects.
    await Promise.all(
      workspacesWithStatus.map(async (project) => {
        const fromSession = project.sessions.map((s) => s.gitBranch).find(Boolean);
        project.branch = fromSession ?? (await this.getBranchFn(project.entry.folders[0]));
      })
    );
```

- [ ] **Step 5: Render branch on the project row**

In `getProjectTreeItem`, replace:

```ts
    const baseDescription = this.getStatusDescription(element);
    item.description = element.worktreeOf
      ? `worktree · ${baseDescription}`
      : baseDescription;
```

with:

```ts
    const statusDescription = this.getStatusDescription(element);
    const descriptionParts: string[] = [];
    if (element.worktreeOf) descriptionParts.push("worktree");
    if (element.branch) descriptionParts.push(element.branch);
    descriptionParts.push(statusDescription);
    item.description = descriptionParts.join(" · ");
```

- [ ] **Step 6: Render title and context % on the session row**

In `getSessionTreeItem`, replace:

```ts
    const label = `PID ${session.pid}`;
```

with:

```ts
    const label = session.title ?? `PID ${session.pid}`;
    const ctxPrefix =
      session.contextPercent !== undefined ? `${session.contextPercent}% · ` : "";
```

In the hooks-mode branch, replace:

```ts
      item.description = `${cfg.label} - ${started}`;
```

with:

```ts
      item.description = `${ctxPrefix}${cfg.label} - ${started}`;
```

In the CPU-mode branch, replace:

```ts
      item.description = isActive
        ? `Working (CPU: ${session.cpuPercent.toFixed(0)}%) - ${started}`
        : `Needs input - ${started}`;
```

with:

```ts
      item.description = isActive
        ? `${ctxPrefix}Working (CPU: ${session.cpuPercent.toFixed(0)}%) - ${started}`
        : `${ctxPrefix}Needs input - ${started}`;
```

In the same method's tooltip section, after:

```ts
    md.appendMarkdown(`**Session** \`${session.sessionId.slice(0, 8)}...\`\n\n`);
```

add:

```ts
    if (session.title) md.appendMarkdown(`- **Title:** ${session.title}\n`);
    if (session.contextPercent !== undefined) {
      md.appendMarkdown(`- **Context:** ${session.contextPercent}%\n`);
    }
    if (session.gitBranch) md.appendMarkdown(`- **Branch:** ${session.gitBranch}\n`);
```

- [ ] **Step 7: Run the provider tests**

Run:

```bash
npx vitest run src/__tests__/projectTreeProvider.test.ts
```

Expected: PASS (new tests and all pre-existing ones).

- [ ] **Step 8: Commit**

```bash
git add src/projectTreeProvider.ts src/__tests__/projectTreeProvider.test.ts
git commit -m "feat: render chat title, context % and branch in the tree"
```

---

### Task 6: Full verification, manual check, and cleanup

**Files:**
- Delete: `docs/superpowers/specs/2026-06-15-session-metadata-display-design.md`

- [ ] **Step 1: Compile and run the whole suite**

Run:

```bash
npm run compile && npx vitest run
```

Expected: compile PASS; all test files PASS (the four new tests plus the prior 114).

- [ ] **Step 2: Package and install for a manual check**

Run:

```bash
npx @vscode/vsce package --no-dependencies
code --install-extension vscode-session-manager-0.8.0.vsix --force
```

Then reload a VS Code window and confirm in the Claude Code Pulse panel:
- Session rows show a chat title (or `PID <n>` if none yet) with a leading `NN% · `.
- Project/worktree rows show the git branch in the dimmed description.

- [ ] **Step 3: Delete the design spec**

The spec was a scratch document for this feature and is no longer needed:

```bash
git rm docs/superpowers/specs/2026-06-15-session-metadata-display-design.md
git commit -m "chore: remove session metadata design spec"
```

---

## Self-Review Notes

- **Spec coverage:** title priority (Task 2), context % with 200k/1M detection (Task 2), branch = last occurrence (Task 2), glob transcript lookup + size/mtime cache + tail read (Task 3), idle-project git fallback (Task 4 + Task 5 step 4), project-row branch + session-row title/% rendering (Task 5), graceful degradation (undefined metadata → PID label, covered by Task 5 step 1 test), tests for every module — all mapped.
- **Type consistency:** `SessionMetadata` / `TailMetadata` shapes, `readSessionMetadataFn` and `getBranchFn` signatures, and the `ClaudeSession` / `WorkspaceWithStatus` field names are identical across Tasks 1–5.
- **No placeholders:** every code and test step contains complete content.
