import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getDownloadsPath } from "@main/events/helpers/get-downloads-path";

import {
  detectEmulator,
  type DetectableBinary,
  type DetectionResult,
} from "../emulators/detect-emulator";
import { getEmulatorVersion } from "../emulators/get-emulator-version";
import { SystemPath } from "../system-path";

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

export const isLikelyRetroArchExecutable = (executablePath: string): boolean =>
  path.basename(executablePath).toLowerCase().includes("retroarch");

const matchesRetroArchBinary = (name: string): boolean => {
  if (process.platform === "win32") return name === "retroarch.exe";
  return name === "retroarch" || name.endsWith(".appimage");
};

const findExecutableInManagedDir = (root: string): string | null => {
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (matchesRetroArchBinary(entry.name.toLowerCase())) {
        return full;
      }
    }
  }
  return null;
};

export const detectRetroArchWithFallback = async (options?: {
  resolveVersion?: boolean;
}): Promise<DetectionResult | null> => {
  const generic = detectRetroArch(options);
  if (generic) return generic;

  const downloadsRoot = await getDownloadsPath().catch(() => null);
  const candidates = [
    downloadsRoot ? path.join(downloadsRoot, "RetroArch") : null,
    path.join(SystemPath.getPath("userData"), "retroarch", "emulator"),
  ].filter((dir): dir is string => dir !== null);

  for (const dir of candidates) {
    const executablePath = findExecutableInManagedDir(dir);
    if (executablePath) {
      return {
        executablePath,
        detectedVersion: options?.resolveVersion
          ? getRetroArchVersion(executablePath)
          : null,
      };
    }
  }

  return null;
};

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
