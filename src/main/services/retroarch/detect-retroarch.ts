import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  detectEmulator,
  type DetectableBinary,
  type DetectionResult,
} from "../emulators/detect-emulator";
import { getEmulatorVersion } from "../emulators/get-emulator-version";

export const RETROARCH_DETECTABLE: DetectableBinary = {
  binary: "retroarch",
  displayName: "RetroArch",
  linuxNames: ["retroarch", "RetroArch"],
  windowsNames: ["retroarch.exe"],
  flatpakIds: ["org.libretro.RetroArch"],
  versionFlags: ["--version"],
};

export const detectRetroArch = (options?: {
  resolveVersion?: boolean;
}): DetectionResult | null => detectEmulator(RETROARCH_DETECTABLE, options);

export const getRetroArchVersion = (executablePath: string): string | null =>
  getEmulatorVersion(executablePath, RETROARCH_DETECTABLE);

const isDirectory = (target: string): boolean => {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
};

const stripQuotes = (value: string): string =>
  value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;

const resolveLibretroPath = (raw: string, cfgPath: string): string => {
  if (raw.startsWith(":")) {
    const relative = raw.slice(1).replace(/^[\\/]/, "");
    return path.join(path.dirname(cfgPath), relative);
  }
  if (raw.startsWith("~")) {
    return path.join(os.homedir(), raw.slice(1));
  }
  return path.isAbsolute(raw) ? raw : path.join(path.dirname(cfgPath), raw);
};

const readLibretroDirectory = (cfgPath: string): string | null => {
  try {
    const content = fs.readFileSync(cfgPath, "utf8");
    for (const line of content.split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      if (line.slice(0, eq).trim() !== "libretro_directory") continue;

      const raw = stripQuotes(line.slice(eq + 1).trim());
      if (!raw) return null;
      return resolveLibretroPath(raw, cfgPath);
    }
    return null;
  } catch {
    return null;
  }
};

const retroArchConfigRoots = (executablePath: string): string[] => {
  const home = os.homedir();

  if (executablePath.includes("org.libretro.RetroArch")) {
    return [
      path.join(
        home,
        ".var",
        "app",
        "org.libretro.RetroArch",
        "config",
        "retroarch"
      ),
    ];
  }

  const roots = [path.dirname(executablePath)];
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) roots.push(path.join(appData, "RetroArch"));
  } else if (process.platform === "darwin") {
    roots.push(path.join(home, "Library", "Application Support", "RetroArch"));
  } else {
    roots.push(path.join(home, ".config", "retroarch"));
  }
  return roots;
};

export const detectRetroArchCoresDir = (
  executablePath: string
): string | null => {
  const roots = retroArchConfigRoots(executablePath);

  for (const root of roots) {
    const resolved = readLibretroDirectory(path.join(root, "retroarch.cfg"));
    if (resolved && isDirectory(resolved)) return resolved;
  }
  for (const root of roots) {
    const dir = path.join(root, "cores");
    if (isDirectory(dir)) return dir;
  }

  return null;
};
