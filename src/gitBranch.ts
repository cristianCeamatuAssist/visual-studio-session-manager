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
