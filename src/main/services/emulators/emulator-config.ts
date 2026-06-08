import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import YAML from "yaml";

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

interface RecursiveInsertState {
  out: string[];
  inserted: boolean;
  alreadyPresent: boolean;
  inGameList: boolean;
  lastGameListIndex: number;
}

const buildLinesWithRecursivePath = (
  lines: string[],
  folderPath: string
): RecursiveInsertState => {
  const out: string[] = [];
  let inGameList = false;
  let inserted = false;
  let alreadyPresent = false;
  let lastGameListIndex = -1;

  for (const line of lines) {
    const sec = line.match(SECTION_RE);
    if (sec) {
      if (inGameList && !inserted && !alreadyPresent) {
        out.splice(lastGameListIndex + 1, 0, `RecursivePaths = ${folderPath}`);
        inserted = true;
      }
      inGameList = sec[1].toLowerCase() === "gamelist";
      out.push(line);
      if (inGameList) lastGameListIndex = out.length - 1;
      continue;
    }
    if (inGameList) {
      const m = line.match(RECURSIVE_RE);
      if (m?.[1] === folderPath) alreadyPresent = true;
      lastGameListIndex = out.length;
    }
    out.push(line);
  }

  return { out, inserted, alreadyPresent, inGameList, lastGameListIndex };
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
    const state = buildLinesWithRecursivePath(lines, folderPath);
    const { out, alreadyPresent, inGameList, lastGameListIndex } = state;
    let inserted = state.inserted;

    if (inGameList && !inserted && !alreadyPresent) {
      out.splice(lastGameListIndex + 1, 0, `RecursivePaths = ${folderPath}`);
      inserted = true;
    }

    if (!inserted && !alreadyPresent) {
      if (out.length > 0 && out.at(-1) !== "") out.push("");
      out.push("[GameList]", `RecursivePaths = ${folderPath}`);
    }

    await fs.writeFile(configPath, out.join("\n"), "utf-8");
    return true;
  } catch {
    return false;
  }
};

// --- RPCS3 games.yml ---------------------------------------------------------
// RPCS3 has no RecursivePaths concept; it stores a flat `TITLEID: path` map in
// games.yml at the config root (the parent of GuiConfigs/), plus disc games in a
// default `games/` subfolder. We read titleids from games.yml (cheap SKU source)
// and merge-write discovered games back so RPCS3 picks them up.

const TITLE_ID_RE = /^[A-Z]{4}\d{5}$/i;

export const rpcs3ConfigRoots = (executablePath: string | null): string[] =>
  rpcs3GuiConfigsCandidates(executablePath).map((p) =>
    path.dirname(path.dirname(p))
  );

export const rpcs3DefaultGamesDirs = (
  executablePath: string | null
): string[] =>
  rpcs3ConfigRoots(executablePath).map((r) => path.join(r, "games"));

export const rpcs3GamesYmlCandidates = (
  executablePath: string | null
): string[] =>
  rpcs3ConfigRoots(executablePath).map((r) => path.join(r, "games.yml"));

export const resolveExistingGamesYml = (
  executablePath: string | null
): string | null => {
  const candidates = rpcs3GamesYmlCandidates(executablePath);
  return findExistingConfig(candidates) ?? candidates[0] ?? null;
};

export const readGamesYml = async (
  executablePath: string | null
): Promise<Map<string, string>> => {
  const ymlPath = findExistingConfig(rpcs3GamesYmlCandidates(executablePath));
  if (!ymlPath) return new Map();

  try {
    const content = await fs.readFile(ymlPath, "utf-8");
    const parsed = YAML.parse(content);
    const out = new Map<string, string>();
    if (parsed && typeof parsed === "object") {
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== "string") continue;
        if (!TITLE_ID_RE.test(key)) continue;
        out.set(key.toUpperCase(), value);
      }
    }
    return out;
  } catch {
    return new Map();
  }
};

const normalizeYmlPath = (raw: string): string =>
  path.normalize(raw).replace(/[\\/]+$/, "");

// Reverse index path -> titleId. Keyed by the normalized full path and by
// basename, so a scanned file/folder can match a games.yml value despite
// trailing-slash/separator differences or flatpak portal rewrites
// (/run/user/.../doc/...), where only the basename survives.
export const buildPathToTitleIdIndex = (
  map: Map<string, string>
): Map<string, string> => {
  const index = new Map<string, string>();
  for (const [titleId, rawPath] of map) {
    const normalized = normalizeYmlPath(rawPath);
    index.set(normalized, titleId);
    const base = path.basename(normalized);
    if (base && !index.has(base)) index.set(base, titleId);
  }
  return index;
};

// Additive, silent merge-write. Backs up the current file once per write, never
// removes/overwrites existing keys, and skips writing when nothing is new.
export const mergeWriteGamesYml = async (
  executablePath: string | null,
  entries: Map<string, string>
): Promise<boolean> => {
  if (entries.size === 0) return false;
  const targetPath = resolveExistingGamesYml(executablePath);
  if (!targetPath) return false;
  if (!existsSync(path.dirname(targetPath))) return false;

  try {
    let existing: Record<string, unknown> = {};
    if (existsSync(targetPath)) {
      const content = await fs.readFile(targetPath, "utf-8");
      const parsed = YAML.parse(content);
      if (parsed && typeof parsed === "object") {
        existing = parsed as Record<string, unknown>;
      }
      await fs
        .writeFile(`${targetPath}.hydra-bak`, content, "utf-8")
        .catch(() => {});
    }

    let added = 0;
    for (const [titleId, gamePath] of entries) {
      if (titleId in existing) continue;
      existing[titleId] = gamePath;
      added += 1;
    }
    if (added === 0) return false;

    await fs.writeFile(targetPath, YAML.stringify(existing), "utf-8");
    return true;
  } catch {
    return false;
  }
};
