import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import type { EmulatorSystem } from "@types";

import {
  duckstationConfigCandidates,
  findExistingConfig,
  pcsx2ConfigCandidates,
} from "./emulator-config";

/*
 * Locating PS1/PS2 BIOS files, mirroring the memory-card dir resolution. Both
 * emulators keep BIOS dumps in a `bios/` directory under their user-data root
 * (DuckStation: the folder holding settings.ini; PCSX2: the parent of `inis/`),
 * and both let the user override it. An explicit override wins, then the default
 * `<dataroot>/bios`, then a portable `<dirname(exe)>/bios`. Hydra never bundles
 * or downloads BIOS files; it only detects whether the user has provided one.
 */

const BIOS_EXTENSIONS = new Set([".bin", ".rom"]);
const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;
const DUCKSTATION_DIR_RE = /^\s*SearchDirectory\s*=\s*(.+)$/i;
const PCSX2_DIR_RE = /^\s*Bios\s*=\s*(.+)$/i;

const PS1_BIOS_MIN_BYTES = 256 * 1024;
const PS2_BIOS_MIN_BYTES = 3 * 1024 * 1024;
const BIOS_MAX_BYTES = 16 * 1024 * 1024;

const SIZE_LIMITS: Record<"ps1" | "ps2", { min: number; max: number }> = {
  ps1: { min: PS1_BIOS_MIN_BYTES, max: BIOS_MAX_BYTES },
  ps2: { min: PS2_BIOS_MIN_BYTES, max: BIOS_MAX_BYTES },
};

const readIniBiosDir = async (
  iniPath: string,
  sectionName: string,
  keyRe: RegExp,
  root: string
): Promise<string | null> => {
  try {
    const content = await fs.readFile(iniPath, "utf-8");
    let inSection = false;
    for (const line of content.split(/\r?\n/)) {
      const sec = line.match(SECTION_RE);
      if (sec) {
        inSection = sec[1].toLowerCase() === sectionName;
        continue;
      }
      if (!inSection) continue;
      const m = line.match(keyRe);
      if (m) {
        const value = m[1].trim();
        if (!value) return null;
        return path.isAbsolute(value) ? value : path.join(root, value);
      }
    }
  } catch {
    return null;
  }
  return null;
};

export const resolvePs1BiosDirs = async (
  executablePath: string | null
): Promise<string[]> => {
  const dirs: string[] = [];
  const iniPath = findExistingConfig(duckstationConfigCandidates());
  if (iniPath) {
    const override = await readIniBiosDir(
      iniPath,
      "bios",
      DUCKSTATION_DIR_RE,
      path.dirname(iniPath)
    );
    if (override) dirs.push(override);
  }
  for (const candidate of duckstationConfigCandidates()) {
    dirs.push(path.join(path.dirname(candidate), "bios"));
  }
  if (executablePath) {
    dirs.push(path.join(path.dirname(executablePath), "bios"));
  }
  return Array.from(new Set(dirs)).filter((dir) => existsSync(dir));
};

export const resolvePs2BiosDirs = async (
  executablePath: string | null
): Promise<string[]> => {
  const dirs: string[] = [];
  const iniPath = findExistingConfig(pcsx2ConfigCandidates(executablePath));
  if (iniPath) {
    const override = await readIniBiosDir(
      iniPath,
      "folders",
      PCSX2_DIR_RE,
      path.dirname(path.dirname(iniPath))
    );
    if (override) dirs.push(override);
  }
  for (const candidate of pcsx2ConfigCandidates(executablePath)) {
    dirs.push(path.join(path.dirname(path.dirname(candidate)), "bios"));
  }
  return Array.from(new Set(dirs)).filter((dir) => existsSync(dir));
};

const hasPlausibleBios = async (
  dir: string,
  limits: { min: number; max: number }
): Promise<boolean> => {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!BIOS_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      const stat = await fs.stat(path.join(dir, entry.name));
      if (stat.size >= limits.min && stat.size <= limits.max) return true;
    } catch {
      // unreadable, keep looking
    }
  }
  return false;
};

export const isPs1BiosInstalled = async (
  executablePath: string | null
): Promise<boolean> => {
  const dirs = await resolvePs1BiosDirs(executablePath);
  for (const dir of dirs) {
    if (await hasPlausibleBios(dir, SIZE_LIMITS.ps1)) return true;
  }
  return false;
};

export const isPs2BiosInstalled = async (
  executablePath: string | null
): Promise<boolean> => {
  const dirs = await resolvePs2BiosDirs(executablePath);
  for (const dir of dirs) {
    if (await hasPlausibleBios(dir, SIZE_LIMITS.ps2)) return true;
  }
  return false;
};

export const isEmulatorBiosInstalled = async (
  system: EmulatorSystem,
  executablePath: string | null
): Promise<boolean> => {
  if (system === "ps1") return isPs1BiosInstalled(executablePath);
  if (system === "ps2") return isPs2BiosInstalled(executablePath);
  return true;
};
