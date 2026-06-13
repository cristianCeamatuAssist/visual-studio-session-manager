import { describe, expect, it } from "vitest";
import { buildWorkspaceRegistration } from "../workspaceIdentity";

describe("buildWorkspaceRegistration", () => {
  it("builds folder identity", () => {
    const registration = buildWorkspaceRegistration({
      pid: 111,
      workspaceFile: undefined,
      workspaceFolders: [
        { uri: { fsPath: "/Users/test/frontend" }, name: "frontend" },
      ],
    });

    expect(registration).toEqual({
      pid: 111,
      folders: ["/Users/test/frontend"],
      name: "frontend",
      kind: "folder",
      workspaceFile: undefined,
    });
  });

  it("builds multi-root workspace identity from workspace file", () => {
    const registration = buildWorkspaceRegistration({
      pid: 222,
      workspaceFile: { fsPath: "/Users/test/Frontend Backend Mobile projects.code-workspace" },
      workspaceFolders: [
        { uri: { fsPath: "/Users/test/frontend/" }, name: "Frontend" },
        { uri: { fsPath: "/Users/test/backend" }, name: "Backend" },
        { uri: { fsPath: "/Users/test/mobile" }, name: "Mobile" },
      ],
    });

    expect(registration).toEqual({
      pid: 222,
      folders: ["/Users/test/frontend", "/Users/test/backend", "/Users/test/mobile"],
      name: "Frontend Backend Mobile projects",
      kind: "workspace",
      workspaceFile: "/Users/test/Frontend Backend Mobile projects.code-workspace",
    });
  });

  it("returns undefined when no workspace folders exist", () => {
    const registration = buildWorkspaceRegistration({
      pid: 333,
      workspaceFile: undefined,
      workspaceFolders: undefined,
    });

    expect(registration).toBeUndefined();
  });
});
