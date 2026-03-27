import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
}));

import * as fs from "fs/promises";
import { HookManager } from "../hookManager";

const mockedReaddir = vi.mocked(fs.readdir);
const mockedReadFile = vi.mocked(fs.readFile);
const mockedWriteFile = vi.mocked(fs.writeFile);
const mockedUnlink = vi.mocked(fs.unlink);

describe("HookManager", () => {
  let hookManager: HookManager;

  beforeEach(() => {
    vi.clearAllMocks();
    hookManager = new HookManager();
  });

  describe("isInstalled", () => {
    it("returns false when settings file does not exist", async () => {
      mockedReadFile.mockRejectedValue(new Error("ENOENT"));
      const result = await hookManager.isInstalled();
      expect(result).toBe(false);
    });

    it("returns false when settings have no hooks", async () => {
      mockedReadFile.mockResolvedValue(JSON.stringify({ permissions: {} }));
      const result = await hookManager.isInstalled();
      expect(result).toBe(false);
    });

    it("returns false when hooks exist but not ours", async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo done" }] }],
          },
        })
      );
      const result = await hookManager.isInstalled();
      expect(result).toBe(false);
    });

    it("returns true when our hook is present", async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            Stop: [
              {
                matcher: "",
                hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh stop" }],
              },
            ],
          },
        })
      );
      const result = await hookManager.isInstalled();
      expect(result).toBe(true);
    });

    it("returns true when UserPromptSubmit hook is present (even if Stop is missing)", async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            UserPromptSubmit: [
              {
                matcher: "",
                hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh start" }],
              },
            ],
          },
        })
      );
      const result = await hookManager.isInstalled();
      expect(result).toBe(true);
    });
  });

  describe("installHooks", () => {
    it("creates settings file if it does not exist", async () => {
      mockedReadFile.mockRejectedValue(new Error("ENOENT"));
      mockedWriteFile.mockResolvedValue(undefined);

      const result = await hookManager.installHooks();
      expect(result).toBe(true);

      // Should write both the hook script and the settings
      expect(mockedWriteFile).toHaveBeenCalledTimes(2);

      // Check that settings contain our hooks
      const settingsCall = mockedWriteFile.mock.calls.find(
        (call) => call[0]?.toString().includes("settings.json")
      );
      expect(settingsCall).toBeDefined();
      const written = JSON.parse(settingsCall![1] as string);
      expect(written.hooks.Stop).toHaveLength(1);
      expect(written.hooks.PreToolUse).toHaveLength(1);
      expect(written.hooks.Stop[0].hooks[0].command).toContain("vscode-session-manager");
    });

    it("preserves existing hooks when adding ours", async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            Stop: [{ matcher: "", hooks: [{ type: "command", command: "echo existing" }] }],
          },
          otherSetting: true,
        })
      );
      mockedWriteFile.mockResolvedValue(undefined);

      const result = await hookManager.installHooks();
      expect(result).toBe(true);

      const settingsCall = mockedWriteFile.mock.calls.find(
        (call) => call[0]?.toString().includes("settings.json")
      );
      const written = JSON.parse(settingsCall![1] as string);
      expect(written.hooks.Stop).toHaveLength(2); // existing + ours
      expect(written.otherSetting).toBe(true);
    });

    it("installs all 5 hook events (Stop, PreToolUse, UserPromptSubmit, Notification, SessionEnd)", async () => {
      mockedReadFile.mockRejectedValue(new Error("ENOENT"));
      mockedWriteFile.mockResolvedValue(undefined);

      await hookManager.installHooks();

      const settingsCall = mockedWriteFile.mock.calls.find(
        (call) => call[0]?.toString().includes("settings.json")
      );
      expect(settingsCall).toBeDefined();
      const written = JSON.parse(settingsCall![1] as string);
      expect(written.hooks.Stop).toHaveLength(1);
      expect(written.hooks.PreToolUse).toHaveLength(1);
      expect(written.hooks.UserPromptSubmit).toHaveLength(1);
      expect(written.hooks.Notification).toHaveLength(1);
      expect(written.hooks.SessionEnd).toHaveLength(1);
      expect(written.hooks.Stop[0].hooks[0].command).toContain("stop");
      expect(written.hooks.PreToolUse[0].hooks[0].command).toContain("resume");
      expect(written.hooks.UserPromptSubmit[0].hooks[0].command).toContain("start");
      expect(written.hooks.Notification[0].matcher).toBe("idle_prompt");
      expect(written.hooks.Notification[0].hooks[0].command).toContain("stop");
      expect(written.hooks.SessionEnd[0].hooks[0].command).toContain("end");
    });

    it("does not duplicate hooks if already installed", async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            Stop: [
              {
                matcher: "",
                hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh stop" }],
              },
            ],
            PreToolUse: [
              {
                matcher: "",
                hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh resume" }],
              },
            ],
            UserPromptSubmit: [
              {
                matcher: "",
                hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh start" }],
              },
            ],
            Notification: [
              {
                matcher: "idle_prompt",
                hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh stop" }],
              },
            ],
            SessionEnd: [
              {
                matcher: "",
                hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh end" }],
              },
            ],
          },
        })
      );
      mockedWriteFile.mockResolvedValue(undefined);

      await hookManager.installHooks();

      const settingsCall = mockedWriteFile.mock.calls.find(
        (call) => call[0]?.toString().includes("settings.json")
      );
      const written = JSON.parse(settingsCall![1] as string);
      expect(written.hooks.Stop).toHaveLength(1);
      expect(written.hooks.PreToolUse).toHaveLength(1);
      expect(written.hooks.UserPromptSubmit).toHaveLength(1);
      expect(written.hooks.Notification).toHaveLength(1);
      expect(written.hooks.SessionEnd).toHaveLength(1);
    });
  });

  describe("getWaitingMarkers", () => {
    it("returns empty set when sessions dir does not exist", async () => {
      mockedReaddir.mockRejectedValue(new Error("ENOENT"));
      const markers = await hookManager.getWaitingMarkers();
      expect(markers.size).toBe(0);
    });

    it("returns empty set when no marker files exist", async () => {
      mockedReaddir.mockResolvedValue(
        ["s1.json", "s2.json"] as unknown as ReturnType<typeof fs.readdir>
      );
      const markers = await hookManager.getWaitingMarkers();
      expect(markers.size).toBe(0);
    });

    it("returns marker IDs from waiting marker files", async () => {
      mockedReaddir.mockResolvedValue(
        [
          "s1.json",
          ".waiting_1001",
          ".waiting_sess-abc123",
          "s2.json",
        ] as unknown as ReturnType<typeof fs.readdir>
      );
      const markers = await hookManager.getWaitingMarkers();
      expect(markers.size).toBe(2);
      expect(markers.has("1001")).toBe(true);
      expect(markers.has("sess-abc123")).toBe(true);
    });
  });

  describe("cleanStaleMarkers", () => {
    it("removes markers for dead PIDs", async () => {
      mockedReaddir.mockResolvedValue(
        [".waiting_1001", ".waiting_1002", ".waiting_sess-abc"] as unknown as ReturnType<typeof fs.readdir>
      );
      mockedUnlink.mockResolvedValue(undefined);

      const alivePids = new Set([1001]);
      const aliveSessionIds = new Set(["sess-abc"]);
      await hookManager.cleanStaleMarkers(alivePids, aliveSessionIds);

      // Should only remove .waiting_1002 (dead PID, not a session ID)
      expect(mockedUnlink).toHaveBeenCalledTimes(1);
      expect(mockedUnlink.mock.calls[0][0]?.toString()).toContain(".waiting_1002");
    });

    it("keeps markers for alive PIDs and session IDs", async () => {
      mockedReaddir.mockResolvedValue(
        [".waiting_1001", ".waiting_sess-abc"] as unknown as ReturnType<typeof fs.readdir>
      );
      mockedUnlink.mockResolvedValue(undefined);

      const alivePids = new Set([1001]);
      const aliveSessionIds = new Set(["sess-abc"]);
      await hookManager.cleanStaleMarkers(alivePids, aliveSessionIds);

      expect(mockedUnlink).not.toHaveBeenCalled();
    });
  });

  describe("uninstallHooks", () => {
    it("removes our hooks from settings", async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            Stop: [
              { matcher: "", hooks: [{ type: "command", command: "echo existing" }] },
              {
                matcher: "",
                hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh stop" }],
              },
            ],
          },
        })
      );
      mockedWriteFile.mockResolvedValue(undefined);
      mockedUnlink.mockResolvedValue(undefined);
      mockedReaddir.mockResolvedValue([] as unknown as ReturnType<typeof fs.readdir>);

      const result = await hookManager.uninstallHooks();
      expect(result).toBe(true);

      const settingsCall = mockedWriteFile.mock.calls.find(
        (call) => call[0]?.toString().includes("settings.json")
      );
      const written = JSON.parse(settingsCall![1] as string);
      expect(written.hooks.Stop).toHaveLength(1);
      expect(written.hooks.Stop[0].hooks[0].command).toBe("echo existing");
    });

    it("removes all 5 hook events when uninstalling", async () => {
      mockedReadFile.mockResolvedValue(
        JSON.stringify({
          hooks: {
            Stop: [
              { matcher: "", hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh stop" }] },
            ],
            PreToolUse: [
              { matcher: "", hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh resume" }] },
            ],
            UserPromptSubmit: [
              { matcher: "", hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh start" }] },
            ],
            Notification: [
              { matcher: "idle_prompt", hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh stop" }] },
            ],
            SessionEnd: [
              { matcher: "", hooks: [{ type: "command", command: "/path/to/vscode-session-manager-hook.sh end" }] },
            ],
          },
        })
      );
      mockedWriteFile.mockResolvedValue(undefined);
      mockedUnlink.mockResolvedValue(undefined);
      mockedReaddir.mockResolvedValue([] as unknown as ReturnType<typeof fs.readdir>);

      const result = await hookManager.uninstallHooks();
      expect(result).toBe(true);

      const settingsCall = mockedWriteFile.mock.calls.find(
        (call) => call[0]?.toString().includes("settings.json")
      );
      const written = JSON.parse(settingsCall![1] as string);
      // All hook arrays should be removed (empty → deleted)
      expect(written.hooks).toBeUndefined();
    });
  });
});
