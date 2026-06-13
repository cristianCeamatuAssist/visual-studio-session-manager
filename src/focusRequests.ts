import * as fs from "fs/promises";
import * as path from "path";
import { FOCUS_REQUESTS_DIR } from "./constants";

export interface FocusRequest {
  pid: number;
  requestedAt: number;
}

export const FOCUS_REQUEST_MAX_AGE_MS = 15000;

export async function writeFocusRequest(pid: number): Promise<void> {
  await fs.mkdir(FOCUS_REQUESTS_DIR, { recursive: true });
  const request: FocusRequest = {
    pid,
    requestedAt: Date.now(),
  };

  await fs.writeFile(focusRequestPath(pid), JSON.stringify(request), "utf-8");
}

export async function readPendingFocusRequests(): Promise<FocusRequest[]> {
  let files: string[];
  try {
    files = await fs.readdir(FOCUS_REQUESTS_DIR);
  } catch {
    return [];
  }

  const now = Date.now();
  const requests: FocusRequest[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }

    const filePath = path.join(FOCUS_REQUESTS_DIR, file);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const request = JSON.parse(content) as Partial<FocusRequest>;
      if (!isFocusRequest(request)) {
        continue;
      }

      if (now - request.requestedAt > FOCUS_REQUEST_MAX_AGE_MS) {
        await fs.unlink(filePath).catch(() => undefined);
        continue;
      }

      requests.push(request);
    } catch {
      continue;
    }
  }

  return requests;
}

export async function clearFocusRequest(pid: number): Promise<void> {
  await fs.unlink(focusRequestPath(pid)).catch(() => undefined);
}

function focusRequestPath(pid: number): string {
  return path.join(FOCUS_REQUESTS_DIR, `${pid}.json`);
}

function isFocusRequest(value: Partial<FocusRequest>): value is FocusRequest {
  return typeof value.pid === "number" && typeof value.requestedAt === "number";
}
