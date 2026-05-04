import { shell } from "electron";
import { spawnSync, exec } from "node:child_process";

export const executeGameInstaller = (filePath: string) => {
  if (process.platform === "win32") {
    shell.openPath(filePath);
    return true;
  }

  if (spawnSync("which", ["wine"]).status === 0) {
    exec(`wine "${filePath}"`);
    return true;
  }

  return false;
};
