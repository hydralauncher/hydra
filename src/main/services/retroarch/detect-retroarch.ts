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

const readLibretroDirectory = (cfgPath: string): string | null => {
  try {
    const content = fs.readFileSync(cfgPath, "utf8");
    const match = /^\s*libretro_directory\s*=\s*"?([^"\r\n]+?)"?\s*$/m.exec(
      content
    );
    if (!match) return null;

    const raw = match[1].trim();
    if (!raw) return null;

    if (raw.startsWith(":")) {
      const relative = raw.slice(1).replace(/^[\\/]/, "");
      return path.join(path.dirname(cfgPath), relative);
    }
    if (raw.startsWith("~")) {
      return path.join(os.homedir(), raw.slice(1));
    }
    return path.isAbsolute(raw) ? raw : path.join(path.dirname(cfgPath), raw);
  } catch {
    return null;
  }
};

export const detectRetroArchCoresDir = (
  executablePath: string
): string | null => {
  const home = os.homedir();
  const exeDir = path.dirname(executablePath);
  const isFlatpak = executablePath.includes("org.libretro.RetroArch");

  const configCandidates: string[] = [];
  const dirCandidates: string[] = [];

  if (isFlatpak) {
    const flatpakConfigDir = path.join(
      home,
      ".var",
      "app",
      "org.libretro.RetroArch",
      "config",
      "retroarch"
    );
    configCandidates.push(path.join(flatpakConfigDir, "retroarch.cfg"));
    dirCandidates.push(path.join(flatpakConfigDir, "cores"));
  } else {
    configCandidates.push(path.join(exeDir, "retroarch.cfg"));
    dirCandidates.push(path.join(exeDir, "cores"));

    if (process.platform === "win32") {
      const appData = process.env.APPDATA;
      if (appData) {
        configCandidates.push(path.join(appData, "RetroArch", "retroarch.cfg"));
        dirCandidates.push(path.join(appData, "RetroArch", "cores"));
      }
    } else if (process.platform === "darwin") {
      const supportDir = path.join(
        home,
        "Library",
        "Application Support",
        "RetroArch"
      );
      configCandidates.push(path.join(supportDir, "retroarch.cfg"));
      dirCandidates.push(path.join(supportDir, "cores"));
    } else {
      const configDir = path.join(home, ".config", "retroarch");
      configCandidates.push(path.join(configDir, "retroarch.cfg"));
      dirCandidates.push(path.join(configDir, "cores"));
    }
  }

  for (const cfg of configCandidates) {
    const resolved = readLibretroDirectory(cfg);
    if (resolved && isDirectory(resolved)) return resolved;
  }
  for (const dir of dirCandidates) {
    if (isDirectory(dir)) return dir;
  }

  return null;
};
