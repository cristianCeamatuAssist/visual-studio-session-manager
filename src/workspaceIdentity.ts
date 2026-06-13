import * as path from "path";
import { WorkspaceRegistrationInput } from "./types";

interface BuildWorkspaceRegistrationOptions {
  pid: number;
  workspaceFile?: { fsPath: string };
  workspaceFolders?: readonly WorkspaceFolderLike[];
}

interface WorkspaceFolderLike {
  uri: { fsPath: string };
  name?: string;
}

function normalizePath(value: string): string {
  return value.replace(/\/+$/, "");
}

export function buildWorkspaceRegistration(
  options: BuildWorkspaceRegistrationOptions
): WorkspaceRegistrationInput | undefined {
  const folders = options.workspaceFolders
    ?.map((folder) => normalizePath(folder.uri.fsPath))
    .filter(Boolean) ?? [];

  if (folders.length === 0) {
    return undefined;
  }

  const workspaceFile = options.workspaceFile?.fsPath
    ? normalizePath(options.workspaceFile.fsPath)
    : undefined;

  if (workspaceFile) {
    return {
      pid: options.pid,
      folders,
      name: path.parse(workspaceFile).name,
      kind: "workspace",
      workspaceFile,
    };
  }

  return {
    pid: options.pid,
    folders,
    name: options.workspaceFolders?.[0]?.name || path.basename(folders[0]),
    kind: "folder",
    workspaceFile: undefined,
  };
}
