import { describe, it, expect } from "vitest";

import { findOwningShellPid, parseParentMap } from "../terminalLocator";

describe("parseParentMap", () => {
  it("parses ps pid and ppid output and skips header and garbage", () => {
    const parentMap = parseParentMap(`
      PID  PPID
      101     1
      202   101
      nope nope
      303   202 extra
      404
    `);

    expect(parentMap).toEqual(
      new Map([
        [101, 1],
        [202, 101],
        [303, 202],
      ])
    );
  });
});

describe("findOwningShellPid", () => {
  it("walks ancestry from target pid to known shell pid", () => {
    const parentMap = new Map([
      [3003, 2002],
      [2002, 1001],
      [1001, 1],
    ]);

    const shellPid = findOwningShellPid(3003, new Set([1001]), parentMap);

    expect(shellPid).toBe(1001);
  });

  it("returns target pid itself when it is in shell set", () => {
    const shellPid = findOwningShellPid(1001, new Set([1001]), new Map());

    expect(shellPid).toBe(1001);
  });

  it("returns undefined when no ancestor matches", () => {
    const parentMap = new Map([
      [3003, 2002],
      [2002, 1001],
      [1001, 1],
    ]);

    const shellPid = findOwningShellPid(3003, new Set([9999]), parentMap);

    expect(shellPid).toBeUndefined();
  });

  it("stops on cycles instead of looping forever", () => {
    const parentMap = new Map([
      [3003, 2002],
      [2002, 3003],
    ]);

    const shellPid = findOwningShellPid(3003, new Set([1001]), parentMap);

    expect(shellPid).toBeUndefined();
  });
});
