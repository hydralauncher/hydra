import { shell } from "electron";

import { parseLaunchOptions } from "./parse-launch-options";

export interface ExecutableShortcut {
  arguments: string[];
  workingDirectory: string | null;
}

export const parseExecutablePath = (path: string) => {
  if (process.platform === "win32" && path.endsWith(".lnk")) {
    const { target } = shell.readShortcutLink(path);

    return target;
  }
  return path;
};

export const readExecutableShortcut = (
  path: string
): ExecutableShortcut | null => {
  if (process.platform !== "win32" || !path.endsWith(".lnk")) return null;

  try {
    const { args, cwd } = shell.readShortcutLink(path);
    return {
      arguments: parseLaunchOptions(args),
      workingDirectory: cwd || null,
    };
  } catch {
    return null;
  }
};
