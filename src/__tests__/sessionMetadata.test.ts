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
