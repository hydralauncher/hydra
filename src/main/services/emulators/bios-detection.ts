import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import type { EmulatorSystem } from "@types";

import { logger } from "@main/services/logger";

import {
  duckstationConfigCandidates,
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

const SECTION_RE = /^\s*\[([^\]]+)\]\s*$/;
const DUCKSTATION_DIR_RE = /^\s*SearchDirectory\s*=(.+)$/i;
const PCSX2_DIR_RE = /^\s*Bios\s*=(.+)$/i;

const PS1_BIOS_MIN_BYTES = 256 * 1024;
const PS1_BIOS_MAX_BYTES = 16 * 1024 * 1024;
const PS2_BIOS_MIN_BYTES = 4 * 1024 * 1024;
const PS2_BIOS_MAX_BYTES = 8 * 1024 * 1024;

const MAX_REJECTED_LOG_ENTRIES = 10;

const SIZE_LIMITS: Record<"ps1" | "ps2", { min: number; max: number }> = {
  ps1: { min: PS1_BIOS_MIN_BYTES, max: PS1_BIOS_MAX_BYTES },
  ps2: { min: PS2_BIOS_MIN_BYTES, max: PS2_BIOS_MAX_BYTES },
};

const isOneDrivePath = (filePath: string): boolean => {
  const lower = filePath.toLowerCase();
  if (lower.split(/[\\/]/).includes("onedrive")) return true;
  for (const key of ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]) {
    const root = process.env[key];
    if (root && lower.startsWith(root.toLowerCase())) return true;
  }
  return false;
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const logReadFailure = (filePath: string, error: unknown): void => {
  logger.warn("[bios-detection] read failed", {
    filePath,
    onedrive: isOneDrivePath(filePath),
    error: describeError(error),
  });
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
  } catch (error) {
    logReadFailure(iniPath, error);
    return null;
  }
  return null;
};

export const resolvePs1BiosDirs = async (
  executablePath: string | null,
  manualBiosPath: string | null = null
): Promise<string[]> => {
  const dirs: string[] = [];
  if (manualBiosPath) dirs.push(manualBiosPath);

  const candidates = duckstationConfigCandidates();
  const foundConfigs: string[] = [];

  for (const iniPath of candidates) {
    if (!existsSync(iniPath)) continue;
    foundConfigs.push(iniPath);
    const override = await readIniBiosDir(
      iniPath,
      "bios",
      DUCKSTATION_DIR_RE,
      path.dirname(iniPath)
    );
    if (override) dirs.push(override);
  }

  for (const candidate of candidates) {
    dirs.push(path.join(path.dirname(candidate), "bios"));
  }
  if (executablePath) {
    dirs.push(path.join(path.dirname(executablePath), "bios"));
  }

  const resolved = Array.from(new Set(dirs)).filter((dir) => existsSync(dir));
  logger.info("[bios-detection] ps1 bios dirs", {
    executablePath,
    manualBiosPath,
    foundConfigs,
    resolved,
  });
  return resolved;
};

export const resolvePs2BiosDirs = async (
  executablePath: string | null,
  manualBiosPath: string | null = null
): Promise<string[]> => {
  const dirs: string[] = [];
  if (manualBiosPath) dirs.push(manualBiosPath);

  const candidates = pcsx2ConfigCandidates(executablePath);
  const foundConfigs: string[] = [];

  for (const iniPath of [...candidates].reverse()) {
    if (!existsSync(iniPath)) continue;
    foundConfigs.push(iniPath);
    const override = await readIniBiosDir(
      iniPath,
      "folders",
      PCSX2_DIR_RE,
      path.dirname(path.dirname(iniPath))
    );
    if (override) dirs.push(override);
  }

  for (const candidate of candidates) {
    dirs.push(path.join(path.dirname(path.dirname(candidate)), "bios"));
  }

  const resolved = Array.from(new Set(dirs)).filter((dir) => existsSync(dir));
  logger.info("[bios-detection] ps2 bios dirs", {
    executablePath,
    manualBiosPath,
    foundConfigs,
    resolved,
  });
  return resolved;
};

const PS1_BIOS_SIGNATURE = Buffer.from("Sony Computer Entertainment");
const PS2_RESET = Buffer.from("RESET");
const PS2_ROMVER = Buffer.from("ROMVER");
const PS2_HEADER_BYTES = 0x80000;
const PS1_HEADER_BYTES = 0x10000;

const fileLooksLikeBios = async (
  filePath: string,
  system: "ps1" | "ps2"
): Promise<boolean> => {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null;
  try {
    handle = await fs.open(filePath, "r");
    const length = system === "ps2" ? PS2_HEADER_BYTES : PS1_HEADER_BYTES;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    const head = buffer.subarray(0, bytesRead);

    if (system === "ps1") return head.includes(PS1_BIOS_SIGNATURE);
    return head.includes(PS2_RESET) && head.includes(PS2_ROMVER);
  } catch (error) {
    logReadFailure(filePath, error);
    return false;
  } finally {
    await handle?.close();
  }
};

const hasPlausibleBios = async (
  dir: string,
  system: "ps1" | "ps2"
): Promise<boolean> => {
  const limits = SIZE_LIMITS[system];

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    logger.info("[bios-detection] unreadable dir", {
      dir,
      error: describeError(error),
    });
    return false;
  }

  let matched = false;
  const rejected: { name: string; size: number; reason: string }[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) continue;
    const filePath = path.join(dir, entry.name);

    let size: number;
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) continue;
      size = stat.size;
    } catch {
      continue;
    }

    if (size < limits.min || size > limits.max) {
      rejected.push({ name: entry.name, size, reason: "size-out-of-band" });
      continue;
    }
    if (await fileLooksLikeBios(filePath, system)) {
      matched = true;
      break;
    }
    rejected.push({ name: entry.name, size, reason: "signature-mismatch" });
  }

  logger.info("[bios-detection] scanned dir", {
    dir,
    system,
    matched,
    rejected: rejected.slice(0, MAX_REJECTED_LOG_ENTRIES),
  });
  return matched;
};

const firstBiosDir = async (
  dirs: string[],
  system: "ps1" | "ps2"
): Promise<string | null> => {
  for (const dir of dirs) {
    if (await hasPlausibleBios(dir, system)) return dir;
  }
  return null;
};

export const resolveInstalledBiosDir = async (
  system: EmulatorSystem,
  executablePath: string | null,
  manualBiosPath: string | null = null
): Promise<string | null> => {
  if (system === "ps1") {
    return firstBiosDir(
      await resolvePs1BiosDirs(executablePath, manualBiosPath),
      "ps1"
    );
  }
  if (system === "ps2") {
    return firstBiosDir(
      await resolvePs2BiosDirs(executablePath, manualBiosPath),
      "ps2"
    );
  }
  return null;
};

export const isPs1BiosInstalled = async (
  executablePath: string | null,
  manualBiosPath: string | null = null
): Promise<boolean> => {
  const dirs = await resolvePs1BiosDirs(executablePath, manualBiosPath);
  return (await firstBiosDir(dirs, "ps1")) !== null;
};

export const isPs2BiosInstalled = async (
  executablePath: string | null,
  manualBiosPath: string | null = null
): Promise<boolean> => {
  const dirs = await resolvePs2BiosDirs(executablePath, manualBiosPath);
  return (await firstBiosDir(dirs, "ps2")) !== null;
};

export const isEmulatorBiosInstalled = async (
  system: EmulatorSystem,
  executablePath: string | null,
  manualBiosPath: string | null = null
): Promise<boolean> => {
  if (system === "ps1") {
    return isPs1BiosInstalled(executablePath, manualBiosPath);
  }
  if (system === "ps2") {
    return isPs2BiosInstalled(executablePath, manualBiosPath);
  }
  return true;
};
