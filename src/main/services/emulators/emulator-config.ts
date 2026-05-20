import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { EmulatorSystem } from "@types";

const SECTION_RE = /^\s*\[(.+?)\]\s*$/;
const RECURSIVE_RE = /^\s*RecursivePaths\s*=\s*(.+?)\s*$/i;

export const duckstationConfigCandidates = (): string[] => {
  const home = homedir();
  if (process.platform === "win32") {
    const local =
      process.env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local");
    return [
      path.join(local, "DuckStation", "settings.ini"),
      path.join(home, "Documents", "DuckStation", "settings.ini"),
    ];
  }
  return [
    path.join(home, ".local", "share", "duckstation", "settings.ini"),
    path.join(
      home,
      ".var",
      "app",
      "org.duckstation.DuckStation",
      "data",
      "duckstation",
      "settings.ini"
    ),
  ];
};

export const pcsx2ConfigCandidates = (
  executablePath: string | null
): string[] => {
  const home = homedir();
  const beside = executablePath
    ? path.join(path.dirname(executablePath), "inis", "PCSX2.ini")
    : null;

  if (process.platform === "win32") {
    const local =
      process.env["LOCALAPPDATA"] ?? path.join(home, "AppData", "Local");
    return [
      path.join(home, "Documents", "PCSX2", "inis", "PCSX2.ini"),
      path.join(local, "PCSX2", "inis", "PCSX2.ini"),
      ...(beside ? [beside] : []),
    ];
  }
  return [
    path.join(home, ".config", "PCSX2", "inis", "PCSX2.ini"),
    path.join(
      home,
      ".var",
      "app",
      "net.pcsx2.PCSX2",
      "config",
      "PCSX2",
      "inis",
      "PCSX2.ini"
    ),
    ...(beside ? [beside] : []),
  ];
};

const configCandidates = (
  system: EmulatorSystem,
  executablePath: string | null
): string[] => {
  if (system === "ps1") return duckstationConfigCandidates();
  if (system === "ps2") return pcsx2ConfigCandidates(executablePath);
  return [];
};

export const rpcs3GuiConfigsCandidates = (
  executablePath: string | null
): string[] => {
  const home = homedir();
  const beside = executablePath
    ? path.join(
        path.dirname(executablePath),
        "GuiConfigs",
        "persistent_settings.dat"
      )
    : null;

  if (process.platform === "win32") {
    const appData =
      process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming");
    return [
      path.join(appData, "rpcs3", "GuiConfigs", "persistent_settings.dat"),
      ...(beside ? [beside] : []),
    ];
  }
  return [
    path.join(
      home,
      ".config",
      "rpcs3",
      "GuiConfigs",
      "persistent_settings.dat"
    ),
    path.join(
      home,
      ".var",
      "app",
      "net.rpcs3.RPCS3",
      "config",
      "rpcs3",
      "GuiConfigs",
      "persistent_settings.dat"
    ),
    ...(beside ? [beside] : []),
  ];
};

export const findExistingConfig = (paths: string[]): string | null => {
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
};

export const readRecursivePaths = async (
  system: EmulatorSystem,
  executablePath: string | null
): Promise<string[]> => {
  const configPath = findExistingConfig(
    configCandidates(system, executablePath)
  );
  if (!configPath) return [];

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const lines = content.split(/\r?\n/);
    const out: string[] = [];
    let inGameList = false;
    for (const line of lines) {
      const sec = line.match(SECTION_RE);
      if (sec) {
        inGameList = sec[1].toLowerCase() === "gamelist";
        continue;
      }
      if (!inGameList) continue;
      const m = line.match(RECURSIVE_RE);
      if (m) out.push(m[1]);
    }
    return Array.from(new Set(out));
  } catch {
    return [];
  }
};

export const addRecursivePath = async (
  system: EmulatorSystem,
  executablePath: string | null,
  folderPath: string
): Promise<boolean> => {
  const configPath = findExistingConfig(
    configCandidates(system, executablePath)
  );
  if (!configPath) return false;

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const lines = content.split(/\r?\n/);
    const out: string[] = [];
    let inGameList = false;
    let inserted = false;
    let alreadyPresent = false;
    let lastGameListIndex = -1;

    for (const line of lines) {
      const sec = line.match(SECTION_RE);
      if (sec) {
        if (inGameList && !inserted && !alreadyPresent) {
          out.splice(
            lastGameListIndex + 1,
            0,
            `RecursivePaths = ${folderPath}`
          );
          inserted = true;
        }
        inGameList = sec[1].toLowerCase() === "gamelist";
        out.push(line);
        if (inGameList) lastGameListIndex = out.length - 1;
        continue;
      }
      if (inGameList) {
        const m = line.match(RECURSIVE_RE);
        if (m && m[1] === folderPath) alreadyPresent = true;
        lastGameListIndex = out.length;
      }
      out.push(line);
    }

    if (inGameList && !inserted && !alreadyPresent) {
      out.splice(lastGameListIndex + 1, 0, `RecursivePaths = ${folderPath}`);
      inserted = true;
    }

    if (!inserted && !alreadyPresent) {
      if (out.length > 0 && out[out.length - 1] !== "") out.push("");
      out.push("[GameList]");
      out.push(`RecursivePaths = ${folderPath}`);
    }

    await fs.writeFile(configPath, out.join("\n"), "utf-8");
    return true;
  } catch {
    return false;
  }
};
