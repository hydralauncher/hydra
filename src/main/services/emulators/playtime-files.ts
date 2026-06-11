import { promises as fs } from "node:fs";
import path from "node:path";

import type { EmulatorSystem } from "@types";

import {
  duckstationConfigCandidates,
  findExistingConfig,
  pcsx2ConfigCandidates,
  rpcs3GuiConfigsCandidates,
} from "./emulator-config";

export const getEmulatorPlaytimeFile = (
  system: EmulatorSystem,
  executablePath: string
): string | null => {
  if (system === "ps1") {
    const cfg = findExistingConfig(duckstationConfigCandidates());
    return cfg ? path.join(path.dirname(cfg), "playtime.dat") : null;
  }
  if (system === "ps2") {
    const cfg = findExistingConfig(pcsx2ConfigCandidates(executablePath));
    return cfg ? path.join(path.dirname(cfg), "playtime.dat") : null;
  }
  return findExistingConfig(rpcs3GuiConfigsCandidates(executablePath));
};

const parsePlaytimeDat = (content: string): Map<string, number> => {
  const out = new Map<string, number>();
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const seconds = Number.parseInt(parts[1], 10);
    if (Number.isFinite(seconds)) out.set(parts[0], seconds);
  }
  return out;
};

const normalizePlaytimeKey = (key: string): string =>
  key.toUpperCase().replace(/[^A-Z0-9]/g, "");

const parsePersistentSettings = (content: string): Map<string, number> => {
  const out = new Map<string, number>();
  let inPlaytime = false;
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sec = /^\[(.+?)\]$/.exec(line);
    if (sec) {
      inPlaytime = sec[1] === "Playtime";
      continue;
    }
    if (!inPlaytime) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = normalizePlaytimeKey(line.slice(0, eq).trim());
    const milliseconds = Number.parseInt(line.slice(eq + 1).trim(), 10);
    if (Number.isFinite(milliseconds)) out.set(key, milliseconds / 1000);
  }
  return out;
};

export const readEmulatorPlaytimeSeconds = async (
  system: EmulatorSystem,
  executablePath: string,
  sku: string
): Promise<number | null> => {
  const file = getEmulatorPlaytimeFile(system, executablePath);
  if (!file) return null;
  try {
    const content = await fs.readFile(file, "utf-8");
    if (system === "ps3") {
      const map = parsePersistentSettings(content);
      return map.get(normalizePlaytimeKey(sku)) ?? null;
    }
    return parsePlaytimeDat(content).get(sku) ?? null;
  } catch {
    return null;
  }
};
