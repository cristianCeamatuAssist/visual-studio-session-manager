# Session Metadata Display Design

**Date:** 2026-06-15
**Status:** Approved (design), pending implementation plan

## Goal

Replace the bare `PID <n>` label on each Claude session row in the Claude Code Pulse
tree with meaningful, human-readable metadata:

- **Chat title** (what the session is about) as the session row label.
- **Context-window usage** as a percentage (e.g. `45%`) in the session row description.
- **Git branch** shown once on the parent project/worktree row (not repeated per session).

The visual result is the two-level layout the user asked for, achieved with the native
VS Code `TreeView` (no webview):

```
▸ ● therapist-assistant               feat/main
▾ ● therapist-assistant-unit-tests    feat/voyager-fix
    ⚡ Fix voyager unit tests          45% · Working - 3d ago
    ⚡ Add reporting feature           21% · Working - 1h ago
▸ ● wd-wellaone-fe                     feat/chat-input-focus
```

- Project/worktree row: branch appended to the existing `description` (dimmed).
- Session row: `label` = chat title, `description` = `<pct>% · <status> - <timeAgo>`.

## Non-Goals

- No webview rewrite of the sessions panel. The native `TreeView` is kept.
- We do **not** modify, wrap, or install a `statusLine` command. (See "Why not statusLine".)
- No live token counting via the Anthropic API. All data comes from local files.

## Data Source: Transcript Parsing

Every Claude Code session writes a transcript at
`~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. Because the `sessionId` is globally
unique, the transcript is located robustly with a glob — `~/.claude/projects/*/<sessionId>.jsonl` —
avoiding any path-encoding assumptions.

The transcript is a JSONL stream of typed records. The relevant ones (confirmed against
real transcripts):

| Field | Source record | Notes |
|---|---|---|
| Chat title (user-set) | `{"type":"custom-title","customTitle":"…"}` | Set via `/rename`. Highest priority. |
| Chat title (auto) | `{"type":"ai-title","aiTitle":"…"}` | Claude-generated. Fallback. |
| Git branch | any record's `"gitBranch":"…"` | Use the **last** occurrence (branch can change mid-session). |
| Context usage | last assistant message `message.usage` | `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. |
| Model | last assistant message `message.model` | Used to pick the context-window size. |

### Title priority

`customTitle` → `aiTitle` → first real user prompt (skipping `<local-command-caveat>` /
attachment / slash-command noise, truncated to ~40 chars) → `PID <n>` (current behavior,
zero regression).

### Context percentage

```
usedTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens   (from last usage)
windowSize = (usedTokens > 200_000 || modelIs1M(model)) ? 1_000_000 : 200_000
contextPercent = round(usedTokens / windowSize * 100)
```

Rationale for the heuristic: a real transcript showed 335k used tokens on model id
`claude-opus-4-8` — the id alone does not reveal the 1M window, but exceeding 200k does.
`modelIs1M()` additionally matches known 1M model ids/markers (e.g. `[1m]`). When no
`usage` exists yet (new session, or just after `/compact`), `contextPercent` is undefined
and the percentage is omitted from the row.

### Why not statusLine

The user already runs a custom `statusLine`, and `statusLine` is a **single** setting — we
would have to overwrite or wrap their command. It also only fires for the actively
rendering session and writes nothing to disk, so it cannot give an external observer data
for every session. Finally, `statusLine`'s `session_name` only reflects `/rename`, while
the transcript additionally exposes `aiTitle`. Transcript parsing is therefore both
non-invasive and richer.

## Components

### New: `src/sessionMetadata.ts` (pure, no `vscode` import — unit-testable)

```ts
export interface SessionMetadata {
  title?: string;        // resolved chat title (undefined → caller falls back to PID)
  contextPercent?: number;
  gitBranch?: string;
}

export function parseSessionMetadata(transcriptContent: string): SessionMetadata;
export function isOneMillionModel(modelId: string | undefined): boolean;
```

All title-priority, window-size, and usage logic lives here and is tested in isolation
against fixture transcript strings.

### New: `src/transcriptReader.ts` (I/O + caching, thin `fs` wrapper)

- `findTranscriptPath(sessionId): Promise<string | undefined>` — glob lookup.
- `readSessionMetadata(sessionId): Promise<SessionMetadata | undefined>` — locate, read,
  parse, and cache.
- **Caching:** keyed by transcript path → `{ size, mtimeMs, metadata }`. Re-parse only when
  the file's size or mtime changes. This avoids re-reading multi-MB transcripts on every
  poll (every 3–5 s, for every session).
- **Read strategy:**
  - *First read for a session:* scan the whole file once to capture the title (`ai-title`
    is written early; `custom-title` wherever `/rename` ran) plus the latest `usage` and
    `gitBranch`. Cache the result.
  - *Subsequent reads (file changed):* read only the last N KB to refresh `usage`,
    `gitBranch`, and any *new* `custom-title` (a `/rename` appends a fresh record near the
    tail at that moment). The cached title is kept unless the tail yields a newer one. This
    keeps frequent refreshes cheap while still catching a late rename.

### Modified: `src/types.ts`

Extend `ClaudeSession` with optional `title`, `contextPercent`, `gitBranch`. All optional →
no breakage for existing call sites / tests.

### Modified: `src/claudeProcessDetector.ts` (or the polling assembler)

After building the base `ClaudeSession[]`, enrich each session with metadata from
`transcriptReader`. Enrichment is best-effort: failures leave the metadata fields
undefined and the row renders exactly as today.

### Modified: `src/projectTreeProvider.ts`

- **Project/worktree row** (`getProjectTreeItem`): append the branch to the existing
  description. Branch is taken from the project's sessions (they share a cwd → a branch).
  When the project has no sessions (or none reports a branch), fall back to resolving the
  branch with a cached `git rev-parse --abbrev-ref HEAD` on the project's first folder, so
  branch still shows on idle project rows. The existing `worktree · …` prefix is preserved.
- **Session row** (`getSessionTreeItem`): `label = session.title ?? \`PID ${session.pid}\``;
  prepend `<pct>% · ` to the description when `contextPercent` is defined. Tooltip gains a
  Title / Context / Branch line.

## Error Handling & Degradation

- Transcript not found → metadata undefined → row shows `PID <n>` (current behavior).
- Corrupt / partially-written JSONL lines → skipped individually; partial metadata returned.
- No `usage` yet → percentage omitted.
- No title yet → PID fallback.
- All file reads wrapped so a failure never throws into the tree refresh.

## Testing

- **`src/__tests__/sessionMetadata.test.ts`** (new): title priority (custom > ai > prompt >
  none), prompt-noise filtering + truncation, window-size selection (200k vs 1M, including
  the >200k auto-detect), branch = last occurrence, percentage rounding, missing usage,
  corrupt lines.
- **`src/__tests__/transcriptReader.test.ts`** (new, `fs` mocked): glob resolution, cache
  hit on unchanged size+mtime, re-parse on change, graceful missing-file.
- **`src/__tests__/projectTreeProvider.test.ts`** (modified): session label uses title with
  PID fallback; description shows `<pct>% · …`; branch appears on the project row and is not
  repeated on session rows.

## Open Questions / Defaults (adjustable later)

- Title truncation length: default ~40 chars with ellipsis.
- Percentage above 100% (overflow before compaction): clamp display at the computed value
  (can exceed 100 briefly); revisit if noisy.
- Tail-read size N: start at 64 KB; tune if a transcript's last `usage` sits further back.
