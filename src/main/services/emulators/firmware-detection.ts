import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { EmulatorSystem } from "@types";

import {
  readShadps4ConfiguredDirectory,
  resolveShadps4UserDir,
} from "./shadps4-files.js";

const firmwareSearchDirs = (executablePath: string | null): string[] => {
  const home = homedir();
  const dirs: string[] = [];

  if (process.platform === "win32") {
    const appData =
      process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming");
    dirs.push(path.join(appData, "rpcs3", "dev_flash"));
  } else {
    dirs.push(
      path.join(home, ".config", "rpcs3", "dev_flash"),
      path.join(
        home,
        ".var",
        "app",
        "net.rpcs3.RPCS3",
        "config",
        "rpcs3",
        "dev_flash"
      )
    );
  }

  if (executablePath) {
    dirs.push(path.join(path.dirname(executablePath), "dev_flash"));
  }

  return dirs;
};

export const findPs3FirmwareDirectory = async (
  executablePath: string | null
): Promise<string | null> => {
  for (const dir of firmwareSearchDirs(executablePath)) {
    if (!existsSync(dir)) continue;
    const sysExternal = path.join(dir, "sys", "external");
    if (!existsSync(sysExternal)) continue;
    try {
      const entries = await fs.readdir(sysExternal);
      if (entries.length > 0) return dir;
    } catch {
      // unreadable — keep looking
    }
  }
  return null;
};

export const findPs4SysModulesDirectory = async (
  executablePath: string | null
): Promise<string> =>
  (await readShadps4ConfiguredDirectory(executablePath, "sys_modules_dir")) ??
  path.join(resolveShadps4UserDir(executablePath), "sys_modules");

const hasPs4SysModules = async (directory: string): Promise<boolean> => {
  try {
    const entries = await fs.readdir(directory);
    return entries.some((entry) => entry.toLowerCase().endsWith(".sprx"));
  } catch {
    return false;
  }
};

export const getEmulatorFirmwareStatus = async (
  system: EmulatorSystem,
  executablePath: string | null
): Promise<{ installed: boolean; path: string | null }> => {
  if (system === "ps3") {
    const firmwarePath = await findPs3FirmwareDirectory(executablePath);
    return { installed: firmwarePath !== null, path: firmwarePath };
  }

  if (system === "ps4") {
    const modulesPath = await findPs4SysModulesDirectory(executablePath);
    return {
      installed: await hasPs4SysModules(modulesPath),
      path: modulesPath,
    };
  }

  return { installed: false, path: null };
};

export const isPs3FirmwareInstalled = async (
  executablePath: string | null
): Promise<boolean> =>
  (await findPs3FirmwareDirectory(executablePath)) !== null;
