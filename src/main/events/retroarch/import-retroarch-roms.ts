import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { registerEvent } from "../register-event";
import {
  setActiveRetroArchImport,
  updateActiveRetroArchImport,
} from "./retroarch-import-state";
import { isWithin } from "../emulators/rom-path-utils";
import {
  persistEntryLocally,
  syncProfileBatch,
} from "../emulators/import-launchbox-roms";
import type { LaunchboxShopDetailsEntry } from "@main/services/emulators";
import { WindowManager, logger, retroarch } from "@main/services";
import { platformToRetroArchPlatform } from "@main/helpers";
import { gamesSublevel } from "@main/level";
import type { ClassicsDisc, RetroArchPlatform, RomFolder } from "@types";

interface FolderInput {
  path: string;
  scanSubfolders: boolean;
}

const inflight = new Map<string, { cancelled: boolean }>();

type CancelSignal = { cancelled: boolean };

export interface RetroArchUnmatchedFile {
  name: string;
  reason: "unmatched";
}

export type RetroArchImportProgress = {
  type: "progress";
  phase: "scanning" | "matching";
  processed: number;
  total: number;
  percent: number;
  currentFile: string | null;
  status: "matched" | "unmatched" | null;
  discovered: number;
  matched: number;
  sizeBytes: number;
};

export interface RetroArchImportResult {
  fileCount: number;
  sizeBytes: number;
  matched: number;
  unmatched: number;
  unmatchedFiles: RetroArchUnmatchedFile[];
  cancelled: boolean;
}

type ProgressFn = (payload: RetroArchImportProgress) => void;

const SCAN_BAND = 10;
const HASH_BAND = 60;

const bandPercent = (
  start: number,
  span: number,
  processed: number,
  total: number
): number => {
  const frac = total > 0 ? Math.min(1, processed / total) : 0;
  return Math.min(100, Math.round((start + frac * span) * 10) / 10);
};

const baseNameWithoutExt = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};

const buildRomDiscList = (
  files: { primaryPath: string; name: string }[]
): ClassicsDisc[] =>
  [...files]
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    )
    .map((f) => ({
      path: f.primaryPath,
      label: baseNameWithoutExt(f.name),
      fileName: f.name,
      sku: null,
    }));

const cancelledResult = (
  fileCount = 0,
  sizeBytes = 0,
  matched = 0,
  unmatched = 0,
  unmatchedFiles: RetroArchUnmatchedFile[] = []
): RetroArchImportResult => ({
  fileCount,
  sizeBytes,
  matched,
  unmatched,
  unmatchedFiles,
  cancelled: true,
});

interface HashedRom extends retroarch.ScannedRetroArchRom {
  crc32: string | null;
}

const hashRoms = async (
  collected: retroarch.ScannedRetroArchRom[],
  signal: CancelSignal,
  onHash?: (processed: number, total: number, currentFile: string) => void
): Promise<HashedRom[]> => {
  const hashed: HashedRom[] = [];
  for (let i = 0; i < collected.length; i++) {
    if (signal.cancelled) break;
    const rom = collected[i];
    const crc = await retroarch.hashRomFile(rom.primaryPath, rom.platform);
    hashed.push({ ...rom, crc32: crc });
    onHash?.(i + 1, collected.length, rom.name);
  }
  return hashed;
};

const matchRoms = async (
  hashed: HashedRom[],
  signal: CancelSignal
): Promise<Map<string, LaunchboxShopDetailsEntry>> => {
  const lookup = new Map<string, LaunchboxShopDetailsEntry>();

  const byPlatform = new Map<RetroArchPlatform, HashedRom[]>();
  for (const rom of hashed) {
    if (!rom.crc32) continue;
    const bucket = byPlatform.get(rom.platform) ?? [];
    bucket.push(rom);
    byPlatform.set(rom.platform, bucket);
  }

  for (const [platform, roms] of byPlatform) {
    if (signal.cancelled) break;
    const platformLookup = await retroarch.fetchShopDetailsForHashes(
      platform,
      roms.map((rom) => ({
        crc32: rom.crc32!,
        fileName: rom.name,
        sizeBytes: rom.sizeBytes,
        serial: null,
      }))
    );
    for (const [hash, entry] of platformLookup) {
      lookup.set(hash, entry);
    }
  }

  return lookup;
};

const persistFolderRollups = async (
  folders: FolderInput[],
  folderRollup: Map<string, { fileCount: number; sizeBytes: number }>
) => {
  await retroarch.updateRetroArchConfig((current) => {
    const nextFolders: RomFolder[] = folders.map((folder) => {
      const existing = current.romFolders.find((f) => f.path === folder.path);
      const rollup = folderRollup.get(folder.path) ?? {
        fileCount: 0,
        sizeBytes: 0,
      };
      return {
        id: existing?.id ?? randomUUID(),
        path: folder.path,
        scanSubfolders: folder.scanSubfolders,
        fileCount: rollup.fileCount,
        sizeBytes: rollup.sizeBytes,
        lastScanAt: Date.now(),
      };
    });

    const untouched = current.romFolders.filter(
      (f) => !folders.some((folder) => folder.path === f.path)
    );

    return retroarch.recomputeRetroArchTotals({
      ...current,
      romFolders: [...untouched, ...nextFolders],
    });
  });
};

export const recomputeRetroArchPlatformCounts = async (): Promise<void> => {
  const config = await retroarch.getRetroArchConfig();
  const folderPaths = config.romFolders.map((folder) => folder.path);

  const counts: Record<RetroArchPlatform, number> = {
    nes: 0,
    snes: 0,
    n64: 0,
    gb: 0,
    gbc: 0,
    gba: 0,
  };

  if (folderPaths.length > 0) {
    const entries = await gamesSublevel.iterator().all();
    for (const [, game] of entries) {
      if (game.isDeleted) continue;
      if (game.shop !== "launchbox") continue;

      const platform = platformToRetroArchPlatform(game.platform);
      if (!platform) continue;

      const discs = game.discs ?? [];
      const inRomFolder = discs.some((disc) =>
        folderPaths.some((folder) => isWithin(disc.path, folder))
      );
      if (!inRomFolder) continue;

      counts[platform] += 1;
    }
  }

  await retroarch.updateRetroArchConfig((current) => ({
    ...current,
    perPlatformCounts: counts,
  }));
};

const reconcileDeletedGames = async (folders: FolderInput[]) => {
  const entries = await gamesSublevel.iterator().all();
  for (const [key, game] of entries) {
    if (game.isDeleted) continue;
    if (game.shop !== "launchbox") continue;
    if (!platformToRetroArchPlatform(game.platform)) continue;

    const discs = game.discs ?? [];
    const inScannedFolders = discs.some((disc) =>
      folders.some((folder) => isWithin(disc.path, folder.path))
    );
    if (!inScannedFolders) continue;

    const stillOnDisk = discs.some((disc) => existsSync(disc.path));
    if (stillOnDisk) continue;

    game.isDeleted = true;
    await gamesSublevel.put(key, game).catch((err) => {
      logger.error("Could not mark stale RetroArch game as deleted", err);
    });
  }
};

export async function runRetroArchImport(
  folders: FolderInput[],
  language: string,
  signal: CancelSignal,
  onProgress?: ProgressFn
): Promise<RetroArchImportResult> {
  const collected = await retroarch.scanRetroArchFolders(
    folders,
    signal,
    (scanned, total, kept) =>
      onProgress?.({
        type: "progress",
        phase: "scanning",
        processed: scanned,
        total,
        percent: bandPercent(0, SCAN_BAND, scanned, total),
        currentFile: null,
        status: null,
        discovered: kept,
        matched: 0,
        sizeBytes: 0,
      })
  );
  if (signal.cancelled) return cancelledResult();
  const totalGames = collected.length;

  const hashed = await hashRoms(
    collected,
    signal,
    (processed, total, currentFile) =>
      onProgress?.({
        type: "progress",
        phase: "scanning",
        processed,
        total,
        percent: bandPercent(SCAN_BAND, HASH_BAND, processed, total),
        currentFile,
        status: null,
        discovered: totalGames,
        matched: 0,
        sizeBytes: 0,
      })
  );
  if (signal.cancelled) return cancelledResult();

  const lookup = await matchRoms(hashed, signal);
  if (signal.cancelled) return cancelledResult();

  const matchedEntries = new Map<string, LaunchboxShopDetailsEntry>();
  const discsByTitle = new Map<
    string,
    { primaryPath: string; name: string }[]
  >();
  const titleInfo = new Map<
    string,
    { folderPath: string; sizeBytes: number; platform: RetroArchPlatform }
  >();
  const unmatchedFiles: RetroArchUnmatchedFile[] = [];
  let matchedSizeBytes = 0;

  for (let i = 0; i < hashed.length; i++) {
    if (signal.cancelled) break;
    const rom = hashed[i];
    const entry = rom.crc32 ? (lookup.get(rom.crc32) ?? null) : null;

    if (entry?.objectId && entry.data) {
      matchedEntries.set(entry.objectId, entry);

      const info = titleInfo.get(entry.objectId);
      if (info) {
        info.sizeBytes += rom.sizeBytes;
      } else {
        titleInfo.set(entry.objectId, {
          folderPath: rom.folderPath,
          sizeBytes: rom.sizeBytes,
          platform: rom.platform,
        });
      }
      matchedSizeBytes += rom.sizeBytes;

      const discs = discsByTitle.get(entry.objectId) ?? [];
      if (!discs.some((d) => d.primaryPath === rom.primaryPath)) {
        discs.push({ primaryPath: rom.primaryPath, name: rom.name });
      }
      discsByTitle.set(entry.objectId, discs);
    } else {
      unmatchedFiles.push({ name: rom.name, reason: "unmatched" });
    }

    onProgress?.({
      type: "progress",
      phase: "matching",
      processed: i + 1,
      total: hashed.length,
      percent: bandPercent(
        SCAN_BAND + HASH_BAND,
        100 - (SCAN_BAND + HASH_BAND),
        i + 1,
        hashed.length
      ),
      currentFile: rom.name,
      status: entry ? "matched" : "unmatched",
      discovered: totalGames,
      matched: matchedEntries.size,
      sizeBytes: matchedSizeBytes,
    });
  }

  const folderRollup = new Map<
    string,
    { fileCount: number; sizeBytes: number }
  >();
  for (const folder of folders) {
    folderRollup.set(folder.path, { fileCount: 0, sizeBytes: 0 });
  }
  for (const info of titleInfo.values()) {
    const bucket = folderRollup.get(info.folderPath);
    if (bucket) {
      bucket.fileCount += 1;
      bucket.sizeBytes += info.sizeBytes;
    }
  }

  let totalFileCount = 0;
  let totalSizeBytes = 0;
  for (const bucket of folderRollup.values()) {
    totalFileCount += bucket.fileCount;
    totalSizeBytes += bucket.sizeBytes;
  }

  if (signal.cancelled) {
    return cancelledResult(
      totalFileCount,
      totalSizeBytes,
      matchedEntries.size,
      unmatchedFiles.length,
      unmatchedFiles
    );
  }

  for (const entry of matchedEntries.values()) {
    if (signal.cancelled) break;
    const titleDiscs = discsByTitle.get(entry.objectId) ?? [];
    const discs = buildRomDiscList(titleDiscs);
    const info = titleInfo.get(entry.objectId);
    const defaultPlatform = info
      ? retroarch.PLATFORM_TO_LAUNCHBOX_NAME[info.platform]
      : null;
    await persistEntryLocally(
      entry,
      language,
      discs,
      defaultPlatform,
      info?.sizeBytes ?? null
    ).catch((err) => {
      logger.error("Failed to persist RetroArch entry locally", err);
    });
  }

  if (signal.cancelled) {
    return cancelledResult(
      totalFileCount,
      totalSizeBytes,
      matchedEntries.size,
      unmatchedFiles.length,
      unmatchedFiles
    );
  }

  await persistFolderRollups(folders, folderRollup);
  await reconcileDeletedGames(folders);
  await recomputeRetroArchPlatformCounts();
  await syncProfileBatch(Array.from(matchedEntries.keys()));

  return {
    fileCount: totalFileCount,
    sizeBytes: totalSizeBytes,
    matched: matchedEntries.size,
    unmatched: unmatchedFiles.length,
    unmatchedFiles,
    cancelled: signal.cancelled,
  };
}

const RETROARCH_IMPORT_PROGRESS_CHANNEL = "on-retroarch-import-progress";

const importRetroArchRoms = async (
  _event: Electron.IpcMainInvokeEvent,
  folders: FolderInput[],
  language: string
) => {
  const requestId = randomUUID();
  const signal = { cancelled: false };
  inflight.set(requestId, signal);

  setActiveRetroArchImport({
    requestId,
    phase: "scanning",
    processed: 0,
    total: 0,
    percent: 0,
    currentFile: null,
    status: null,
    discovered: 0,
    matched: 0,
    sizeBytes: 0,
  });
  WindowManager.sendToAppWindows("on-retroarch-import-status", true);

  void (async () => {
    try {
      const result = await runRetroArchImport(
        folders,
        language,
        signal,
        (payload) => {
          updateActiveRetroArchImport({
            phase: payload.phase,
            processed: payload.processed,
            total: payload.total,
            percent: payload.percent,
            currentFile: payload.currentFile,
            status: payload.status,
            discovered: payload.discovered,
            matched: payload.matched,
            sizeBytes: payload.sizeBytes,
          });
          WindowManager.sendToAppWindows(RETROARCH_IMPORT_PROGRESS_CHANNEL, {
            requestId,
            ...payload,
          });
        }
      );

      WindowManager.sendToAppWindows(RETROARCH_IMPORT_PROGRESS_CHANNEL, {
        type: result.cancelled ? "cancelled" : "done",
        requestId,
        fileCount: result.fileCount,
        sizeBytes: result.sizeBytes,
        matched: result.matched,
        unmatched: result.unmatched,
        unmatchedFiles: result.unmatchedFiles,
      });
    } catch (err) {
      WindowManager.sendToAppWindows(RETROARCH_IMPORT_PROGRESS_CHANNEL, {
        type: "error",
        requestId,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inflight.delete(requestId);
      setActiveRetroArchImport(null);
      WindowManager.sendToAppWindows("on-retroarch-import-status", false);
    }
  })();

  return { requestId };
};

const cancelRetroArchImport = async (
  _event: Electron.IpcMainInvokeEvent,
  requestId: string
) => {
  const signal = inflight.get(requestId);
  if (signal) signal.cancelled = true;
};

registerEvent("importRetroArchRoms", importRetroArchRoms);
registerEvent("cancelRetroArchImport", cancelRetroArchImport);
