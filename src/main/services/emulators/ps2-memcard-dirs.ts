import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import { findExistingConfig, pcsx2ConfigCandidates } from "./emulator-config";

/*
 * Locating PCSX2 memory card (`.ps2`) files. The `memcards/` directory is a
 * sibling of `inis/` under the PCSX2 user-data root, so we derive it from the
 * same candidate set the INI reader uses. We also honour an explicit
 * `[Folders] MemoryCards=` override in PCSX2.ini.
 */

const MEMCARD_EXTENSIONS = new Set([".ps2", ".mcd", ".mc2"]);
const SECTION_RE = /^\s*\[(.+?)\]\s*$/;
const FOLDERS_MEMCARDS_RE = /^\s*MemoryCards\s*=\s*(.+?)\s*$/i;

export const pcsx2MemcardDirCandidates = (
  executablePath: string | null
): string[] => {
  const dirs = pcsx2ConfigCandidates(executablePath).map((iniPath) =>
    path.join(path.dirname(path.dirname(iniPath)), "memcards")
  );
  return Array.from(new Set(dirs));
};

// PCSX2.ini `[Folders] MemoryCards = <path>` (absolute, or relative to the root).
export const readPcsx2MemcardDirFromIni = async (
  executablePath: string | null
): Promise<string | null> => {
  const iniPath = findExistingConfig(pcsx2ConfigCandidates(executablePath));
  if (!iniPath) return null;
  try {
    const content = await fs.readFile(iniPath, "utf-8");
    let inFolders = false;
    for (const line of content.split(/\r?\n/)) {
      const sec = line.match(SECTION_RE);
      if (sec) {
        inFolders = sec[1].toLowerCase() === "folders";
        continue;
      }
      if (!inFolders) continue;
      const m = line.match(FOLDERS_MEMCARDS_RE);
      if (m) {
        const value = m[1].trim();
        if (!value) return null;
        const root = path.dirname(path.dirname(iniPath));
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

/** Existing memory card directories for PS2 (INI override first, then defaults). */
export const resolvePs2MemcardDirs = async (
  executablePath: string | null
): Promise<string[]> => {
  const dirs: string[] = [];
  const iniDir = await readPcsx2MemcardDirFromIni(executablePath);
  if (iniDir) dirs.push(iniDir);
  dirs.push(...pcsx2MemcardDirCandidates(executablePath));
  return Array.from(new Set(dirs)).filter((dir) => existsSync(dir));
};

/** Every `.ps2`/`.mcd`/`.mc2` file under the resolved PS2 memory card dirs. */
export const resolvePs2MemcardFiles = async (
  executablePath: string | null
): Promise<string[]> => {
  const dirs = await resolvePs2MemcardDirs(executablePath);
  const files: string[] = [];
  for (const dir of dirs) {
    files.push(...(await enumerateMemcardFiles(dir)));
  }
  return Array.from(new Set(files));
};
