import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({ execFile: vi.fn() }));

import { execFile } from "child_process";
import { getGitBranch } from "../gitBranch";

const mockedExecFile = vi.mocked(execFile);

function execReturns(stdout: string, err: Error | null = null): void {
  mockedExecFile.mockImplementation(((_file: string, _args: string[], cb: (e: Error | null, r: { stdout: string; stderr: string }) => void) => {
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
    expect(mockedExecFile).toHaveBeenCalledTimes(1);

    await getGitBranch("/repo-d", 1000 + 60_000); // past TTL → re-run
    expect(mockedExecFile).toHaveBeenCalledTimes(2);
  });
});
