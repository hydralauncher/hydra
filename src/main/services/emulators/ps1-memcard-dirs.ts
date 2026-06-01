import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import {
  duckstationConfigCandidates,
  findExistingConfig,
} from "./emulator-config";

/*
 * Locating DuckStation (PS1) memory card files. DuckStation keeps cards in a
 * `memcards/` directory under its user-data root (the folder holding
 * settings.ini), so we derive candidates from the same config locations the
 * rest of the emulator code uses. A portable install keeps `memcards/` beside
 * the executable. An explicit `[MemoryCards] Directory =` override in
 * settings.ini wins.
 *
 * DuckStation's default is "one card per game", so files are typically named by
 * serial (`SLUS-00594.mcd`); shared cards are `shared_card_*.mcd`. The native
 * format is raw `.mcd`; `.mcr`/`.mc`/`.gme`/`.vgs`/`.vmp` are also read.
 */

const MEMCARD_EXTENSIONS = new Set([
  ".mcd",
  ".mcr",
  ".mc",
  ".gme",
  ".vgs",
  ".vmp",
]);
const SECTION_RE = /^\s*\[(.+?)\]\s*$/;
const DIRECTORY_RE = /^\s*Directory\s*=\s*(.+?)\s*$/i;

export const duckstationMemcardDirCandidates = (
  executablePath: string | null
): string[] => {
  const dirs = duckstationConfigCandidates().map((iniPath) =>
    path.join(path.dirname(iniPath), "memcards")
  );
  if (executablePath) {
    dirs.push(path.join(path.dirname(executablePath), "memcards"));
  }
  return Array.from(new Set(dirs));
};

// settings.ini `[MemoryCards] Directory = <path>` (absolute, or relative to the
// data root that holds settings.ini).
export const readDuckstationMemcardDirFromIni = async (): Promise<
  string | null
> => {
  const iniPath = findExistingConfig(duckstationConfigCandidates());
  if (!iniPath) return null;
  try {
    const content = await fs.readFile(iniPath, "utf-8");
    let inMemoryCards = false;
    for (const line of content.split(/\r?\n/)) {
      const sec = line.match(SECTION_RE);
      if (sec) {
        inMemoryCards = sec[1].toLowerCase() === "memorycards";
        continue;
      }
      if (!inMemoryCards) continue;
      const m = line.match(DIRECTORY_RE);
      if (m) {
        const value = m[1].trim();
        if (!value) return null;
        const root = path.dirname(iniPath);
        return path.isAbsolute(value) ? value : path.join(root, value);
      }
    }
  } catch {
    return null;
  }
  return null;
};

const enumerateMemcardFiles = async (dir: string): Promise<string[]> => {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter(
        (e) =>
          e.isFile() &&
          MEMCARD_EXTENSIONS.has(path.extname(e.name).toLowerCase())
      )
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
};

/** Existing memory card directories for PS1 (INI override first, then defaults). */
export const resolvePs1MemcardDirs = async (
  executablePath: string | null
): Promise<string[]> => {
  const dirs: string[] = [];
  const iniDir = await readDuckstationMemcardDirFromIni();
  if (iniDir) dirs.push(iniDir);
  dirs.push(...duckstationMemcardDirCandidates(executablePath));
  return Array.from(new Set(dirs)).filter((dir) => existsSync(dir));
};

/** Every PS1 memory card file under the resolved DuckStation memory card dirs. */
export const resolvePs1MemcardFiles = async (
  executablePath: string | null
): Promise<string[]> => {
  const dirs = await resolvePs1MemcardDirs(executablePath);
  const files: string[] = [];
  for (const dir of dirs) {
    files.push(...(await enumerateMemcardFiles(dir)));
  }
  return Array.from(new Set(files));
};
