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
