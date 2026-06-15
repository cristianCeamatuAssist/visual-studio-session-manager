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
