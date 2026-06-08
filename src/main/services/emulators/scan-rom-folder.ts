import { promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";

import type { KnownBinary } from "./known-binaries";
import { resolveSniffTarget, sniffDiscImage } from "./sniff-disc-platform";
import type { EmulatorSystem } from "@types";

const MAX_ENTRIES_PER_DIR = 5000;

export interface ScannedGame {
  primaryPath: string;
  name: string;
  sizeBytes: number;
}

export interface ScanResult {
  fileCount: number;
  sizeBytes: number;
  games: ScannedGame[];
}

export interface ScanProgress {
  processed: number;
  total: number;
  currentFile: string | null;
}

export interface ScanOptions {
  onProgress?: (p: ScanProgress) => void;
  signal?: { cancelled: boolean };
}

interface Candidate {
  fullPath: string;
  name: string;
  isMarkerDir: boolean;
}

const matchesExtension = (name: string, extensions: string[]): boolean => {
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
};

const isDirectoryMarker = (name: string, markers: string[]): boolean =>
  markers.length > 0 && markers.includes(name);

const extOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const basenameNoExt = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
};

const PS1_PRIMARY_EXTS = new Set([
  ".cue",
  ".ccd",
  ".mds",
  ".chd",
  ".pbp",
  ".iso",
  ".ecm",
]);
const PS1_PAIR_RULES: Record<string, string[]> = {
  ".cue": [".bin"],
  ".ccd": [".img", ".sub"],
  ".mds": [".mdf"],
};

const PS2_PRIMARY_EXTS = new Set([
  ".iso",
  ".chd",
  ".cso",
  ".zso",
  ".gz",
  ".nrg",
  ".cue",
  ".mds",
]);
const PS2_PAIR_RULES: Record<string, string[]> = {
  ".cue": [".bin"],
  ".mds": [".mdf"],
};

const PS3_LAUNCHABLE_EXTS = new Set([".iso", ".pkg", ".elf", ".self"]);

const SNIFFABLE_EXTS = new Set([
  ".cue",
  ".iso",
  ".img",
  ".mds",
  ".ccd",
  ".bin",
  ".mdf",
]);

const PS3_INTERNAL_FILES = new Set(["eboot.bin", "param.sfo", "ps3_disc.sfb"]);

const DIR_SIZE_ENTRY_CAP = 100_000;

const safeRealpath = async (p: string): Promise<string | null> => {
  try {
    return await fs.realpath(p);
  } catch {
    return null;
  }
};

const safeReaddirTypes = async (dir: string): Promise<Dirent[] | null> => {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
};

const safeStatSize = async (p: string): Promise<number | null> => {
  try {
    return (await fs.stat(p)).size;
  } catch {
    return null;
  }
};

const safeFileSize = async (p: string): Promise<number> =>
  (await safeStatSize(p)) ?? 0;

const computeDirSize = async (root: string): Promise<number> => {
  let total = 0;
  let visited = 0;
  const queue: string[] = [root];
  const seen = new Set<string>();
  for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
    const real = await safeRealpath(dir);
    if (real === null || seen.has(real)) continue;
    seen.add(real);
    const entries = await safeReaddirTypes(dir);
    if (!entries) continue;
    for (const entry of entries) {
      if (visited++ > DIR_SIZE_ENTRY_CAP) return total;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile()) total += await safeFileSize(full);
    }
  }
  return total;
};

const shouldCountForSystem = async (
  candidate: Candidate,
  system: EmulatorSystem
): Promise<boolean> => {
  if (candidate.isMarkerDir) return true;
  const ext = extOf(candidate.name);

  if (system === "ps3") {
    if (PS3_INTERNAL_FILES.has(candidate.name.toLowerCase())) return false;
    if (ext === ".iso") {
      const target = await resolveSniffTarget(candidate.fullPath);
      if (!target) return true;
      const detected = await sniffDiscImage(target);
      return detected === "ps3" || detected === "unknown";
    }
    return ext === ".pkg" || ext === ".elf" || ext === ".self";
  }

  if (!SNIFFABLE_EXTS.has(ext)) return true;
  const target = await resolveSniffTarget(candidate.fullPath);
  if (!target) return true;
  const detected = await sniffDiscImage(target);
  if (detected === "unknown") return true;
  return detected === system;
};

interface GameGroup {
  primary: Candidate;
  sidecars: Candidate[];
}

const buildSidecarMap = (
  group: Candidate[],
  pairRules: Record<string, string[]>
): { sidecarOf: Map<string, Candidate[]>; skipped: Set<string> } => {
  const sidecarOf = new Map<string, Candidate[]>();
  const skipped = new Set<string>();
  for (const f of group) {
    const sidecarExts = pairRules[extOf(f.name)];
    if (!sidecarExts) continue;
    const base = basenameNoExt(f.name);
    const matched: Candidate[] = [];
    for (const other of group) {
      if (other === f || basenameNoExt(other.name) !== base) continue;
      if (sidecarExts.includes(extOf(other.name))) {
        matched.push(other);
        skipped.add(other.fullPath);
      }
    }
    sidecarOf.set(f.fullPath, matched);
  }
  return { sidecarOf, skipped };
};

const collectSidecarExts = (
  pairRules: Record<string, string[]>
): Set<string> => {
  const exts = new Set<string>();
  for (const list of Object.values(pairRules)) {
    for (const ext of list) exts.add(ext);
  }
  return exts;
};

const applyPairedRules = (
  group: Candidate[],
  primaryExts: Set<string>,
  pairRules: Record<string, string[]>
): GameGroup[] => {
  const m3u = group.filter((f) => extOf(f.name) === ".m3u");
  if (m3u.length > 0) return m3u.map((primary) => ({ primary, sidecars: [] }));

  const { sidecarOf, skipped } = buildSidecarMap(group, pairRules);
  const sidecarExts = collectSidecarExts(pairRules);

  const out: GameGroup[] = [];
  for (const f of group) {
    if (skipped.has(f.fullPath)) continue;
    const ext = extOf(f.name);
    if (primaryExts.has(ext)) {
      out.push({ primary: f, sidecars: sidecarOf.get(f.fullPath) ?? [] });
    } else if (sidecarExts.has(ext)) {
      out.push({ primary: f, sidecars: [] });
    }
  }
  return out;
};

const applyPs3Rules = (group: Candidate[]): GameGroup[] =>
  group
    .filter((f) => PS3_LAUNCHABLE_EXTS.has(extOf(f.name)))
    .map((primary) => ({ primary, sidecars: [] }));

const dedupGames = (binary: KnownBinary, files: Candidate[]): GameGroup[] => {
  const markerDirs = files.filter((f) => f.isMarkerDir);
  const regular = files.filter((f) => !f.isMarkerDir);

  const byDir = new Map<string, Candidate[]>();
  for (const f of regular) {
    const parent = path.dirname(f.fullPath);
    const arr = byDir.get(parent) ?? [];
    arr.push(f);
    byDir.set(parent, arr);
  }

  const games: GameGroup[] = markerDirs.map((primary) => ({
    primary,
    sidecars: [],
  }));
  for (const [, group] of byDir) {
    if (binary.system === "ps3") {
      games.push(...applyPs3Rules(group));
    } else if (binary.system === "ps2") {
      games.push(...applyPairedRules(group, PS2_PRIMARY_EXTS, PS2_PAIR_RULES));
    } else {
      games.push(...applyPairedRules(group, PS1_PRIMARY_EXTS, PS1_PAIR_RULES));
    }
  }
  return games;
};

const collectEntry = (
  entry: Dirent,
  dir: string,
  binary: KnownBinary,
  scanSubfolders: boolean,
  candidates: Candidate[],
  queue: string[]
): void => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    if (isDirectoryMarker(entry.name, binary.romDirectoryMarkers)) {
      candidates.push({ fullPath: full, name: entry.name, isMarkerDir: true });
    } else if (scanSubfolders) {
      queue.push(full);
    }
    return;
  }
  if (!entry.isFile()) return;
  if (matchesExtension(entry.name, binary.romExtensions)) {
    candidates.push({ fullPath: full, name: entry.name, isMarkerDir: false });
  }
};

const collectCandidates = async (
  rootPath: string,
  binary: KnownBinary,
  scanSubfolders: boolean
): Promise<Candidate[]> => {
  const candidates: Candidate[] = [];
  const queue: string[] = [rootPath];
  const seen = new Set<string>();

  for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
    const real = await safeRealpath(dir);
    if (real === null || seen.has(real)) continue;
    seen.add(real);

    const entries = await safeReaddirTypes(dir);
    if (!entries || entries.length > MAX_ENTRIES_PER_DIR) continue;

    for (const entry of entries) {
      collectEntry(entry, dir, binary, scanSubfolders, candidates, queue);
    }
  }

  return candidates;
};

const sizeGame = async (
  game: GameGroup
): Promise<{ countedFiles: number; sizeBytes: number }> => {
  let gameSize = 0;
  let countedFiles = 0;

  if (game.primary.isMarkerDir) {
    gameSize += await computeDirSize(game.primary.fullPath);
    countedFiles = 1;
  } else {
    const size = await safeStatSize(game.primary.fullPath);
    if (size !== null) {
      countedFiles = 1;
      gameSize += size;
    }
  }

  for (const sidecar of game.sidecars) {
    gameSize += await safeFileSize(sidecar.fullPath);
  }

  return { countedFiles, sizeBytes: gameSize };
};

export const scanRomFolder = async (
  rootPath: string,
  binary: KnownBinary,
  scanSubfolders: boolean,
  options?: ScanOptions
): Promise<ScanResult> => {
  const raw = await collectCandidates(rootPath, binary, scanSubfolders);
  const games = dedupGames(binary, raw);
  const total = games.length;

  let fileCount = 0;
  let sizeBytes = 0;
  let processed = 0;
  const scannedGames: ScannedGame[] = [];

  options?.onProgress?.({ processed: 0, total, currentFile: null });

  for (const game of games) {
    if (options?.signal?.cancelled) break;

    if (await shouldCountForSystem(game.primary, binary.system)) {
      const sized = await sizeGame(game);
      fileCount += sized.countedFiles;
      sizeBytes += sized.sizeBytes;
      scannedGames.push({
        primaryPath: game.primary.fullPath,
        name: game.primary.name,
        sizeBytes: sized.sizeBytes,
      });
    }

    processed += 1;
    options?.onProgress?.({
      processed,
      total,
      currentFile: game.primary.name,
    });
  }

  return { fileCount, sizeBytes, games: scannedGames };
};
