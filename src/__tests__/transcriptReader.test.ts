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
    mockedReaddir.mockResolvedValue(["proj-a"] as never);
    mockedAccess.mockRejectedValue(new Error("ENOENT"));

    const reader = new TranscriptReader();
    expect(await reader.readSessionMetadata("missing")).toBeUndefined();
  });

  it("locates the transcript by glob and parses metadata on first read", async () => {
    mockedReaddir.mockResolvedValue(["proj-a", "proj-b"] as never);
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
    mockedReaddir.mockResolvedValue(["proj"] as never);
    mockedAccess.mockResolvedValue(undefined as never);
    mockedStat.mockResolvedValue({ size: 100, mtimeMs: 5 } as never);
    mockedReadFile.mockResolvedValue(aiTitleLine("Cached") as never);

    const reader = new TranscriptReader();
    await reader.readSessionMetadata("sid");
    await reader.readSessionMetadata("sid");

    expect(mockedReadFile).toHaveBeenCalledTimes(1);
  });

  it("does a tail read keeping the cached title when the file grows", async () => {
    mockedReaddir.mockResolvedValue(["proj"] as never);
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
