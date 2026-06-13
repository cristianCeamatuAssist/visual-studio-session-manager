import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}));

import * as fs from "fs/promises";
import { resolveWorktree } from "../worktreeResolver";

const mockedStat = vi.mocked(fs.stat);
const mockedReadFile = vi.mocked(fs.readFile);

describe("resolveWorktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns not worktree when .git is a directory", async () => {
    mockedStat.mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
    } as fs.Stats);

    const result = await resolveWorktree("/Users/test/myrepo");

    expect(result).toEqual({ isWorktree: false });
    expect(mockedReadFile).not.toHaveBeenCalled();
  });

  it("resolves absolute gitdir pointer to main repository root", async () => {
    mockedStat.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
    } as fs.Stats);
    mockedReadFile.mockResolvedValue(
      "gitdir: /Users/test/myrepo/.git/worktrees/feature-x\n"
    );

    const result = await resolveWorktree("/Users/test/worktrees/feature-x");

    expect(result).toEqual({
      isWorktree: true,
      mainRepoRoot: "/Users/test/myrepo",
    });
  });

  it("resolves relative gitdir pointer against worktree folder", async () => {
    mockedStat.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
    } as fs.Stats);
    mockedReadFile.mockResolvedValue(
      "gitdir: ../myrepo/.git/worktrees/feature-x\n"
    );

    const result = await resolveWorktree("/Users/test/feature-x");

    expect(result).toEqual({
      isWorktree: true,
      mainRepoRoot: "/Users/test/myrepo",
    });
  });

  it("returns not worktree when .git is missing", async () => {
    mockedStat.mockRejectedValue(new Error("ENOENT"));

    const result = await resolveWorktree("/Users/test/worktrees/feature-x");

    expect(result).toEqual({ isWorktree: false });
  });

  it("returns not worktree for malformed .git file", async () => {
    mockedStat.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
    } as fs.Stats);
    mockedReadFile.mockResolvedValue("not a gitdir pointer\n");

    const result = await resolveWorktree("/Users/test/worktrees/feature-x");

    expect(result).toEqual({ isWorktree: false });
  });
});
