import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("fs/promises", () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
}));

import * as fs from "fs/promises";
import { FOCUS_REQUESTS_DIR } from "../constants";
import {
  FOCUS_REQUEST_MAX_AGE_MS,
  clearFocusRequest,
  readPendingFocusRequests,
  writeFocusRequest,
} from "../focusRequests";

const mockedMkdir = vi.mocked(fs.mkdir);
const mockedWriteFile = vi.mocked(fs.writeFile);
const mockedReaddir = vi.mocked(fs.readdir);
const mockedReadFile = vi.mocked(fs.readFile);
const mockedUnlink = vi.mocked(fs.unlink);

describe("focusRequests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mockedMkdir.mockResolvedValue(undefined);
    mockedWriteFile.mockResolvedValue(undefined);
    mockedUnlink.mockResolvedValue(undefined);
  });

  it("writes a focus request file for the pid", async () => {
    vi.setSystemTime(new Date("2026-06-13T10:00:00.000Z"));

    await writeFocusRequest(4242);

    expect(mockedMkdir).toHaveBeenCalledWith(FOCUS_REQUESTS_DIR, {
      recursive: true,
    });
    expect(mockedWriteFile).toHaveBeenCalledWith(
      `${FOCUS_REQUESTS_DIR}/4242.json`,
      JSON.stringify({ pid: 4242, requestedAt: Date.now() }),
      "utf-8"
    );
  });

  it("returns non-expired requests and unlinks expired requests", async () => {
    const now = Date.now();
    mockedReaddir.mockResolvedValue(
      ["111.json", "222.json"] as unknown as ReturnType<typeof fs.readdir>
    );
    mockedReadFile.mockImplementation(async (filePath) => {
      const fp = filePath.toString();
      if (fp.endsWith("111.json")) {
        return JSON.stringify({ pid: 111, requestedAt: now - 1000 });
      }
      return JSON.stringify({
        pid: 222,
        requestedAt: now - FOCUS_REQUEST_MAX_AGE_MS - 1,
      });
    });

    const requests = await readPendingFocusRequests();

    expect(requests).toEqual([{ pid: 111, requestedAt: now - 1000 }]);
    expect(mockedUnlink).toHaveBeenCalledWith(`${FOCUS_REQUESTS_DIR}/222.json`);
  });

  it("returns empty array when directory is missing", async () => {
    mockedReaddir.mockRejectedValue(new Error("ENOENT"));

    const requests = await readPendingFocusRequests();

    expect(requests).toEqual([]);
  });

  it("swallows missing files when clearing a focus request", async () => {
    mockedUnlink.mockRejectedValue(new Error("ENOENT"));

    await expect(clearFocusRequest(4242)).resolves.not.toThrow();

    expect(mockedUnlink).toHaveBeenCalledWith(`${FOCUS_REQUESTS_DIR}/4242.json`);
  });
});
