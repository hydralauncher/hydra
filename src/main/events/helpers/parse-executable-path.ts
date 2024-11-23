import { shell } from "electron";

export const parseExecutablePath = (path: string) => {
  if (process.platform === "win32" && path.endsWith(".lnk")) {
    const { target } = shell.readShortcutLink(path);

    return target;
  }
  return path;
};
