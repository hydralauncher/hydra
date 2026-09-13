import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";

import { registerEvent } from "../register-event";
import {
  setActiveRetroArchImport,
  updateActiveRetroArchImport,
} from "./retroarch-import-state";
import { isWithin } from "../emulators/rom-path-utils";
import {
  reconcileDiscsAfterScan,
  reconcileDiscsForRemovedFolder,
  type DiscReconciliation,
} from "./reconcile-discs";
import {
  bandPercent,
  baseNameWithoutExt,
} from "../emulators/import-progress-utils";
import {
  persistEntryLocally,
  syncProfileBatch,
} from "../emulators/import-launchbox-roms";
import type { LaunchboxShopDetailsEntry } from "@main/services/emulators";
import { WindowManager, logger, retroarch } from "@main/services";
import { platformToRetroArchPlatform } from "@main/helpers";
import { gamesSublevel } from "@main/level";
import type { ClassicsDisc, Game, RetroArchPlatform, RomFolder } from "@types";

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
    if (!crc) {
      logger.warn("Failed to hash ROM file", {
        path: rom.primaryPath,
        platform: rom.platform,
      });
    }
    hashed.push({ ...rom, crc32: crc });
    onHash?.(i + 1, collected.length, rom.name);
  }
  return hashed;
};

const matchRoms = async (
  hashed: HashedRom[],
  language: string,
  signal: CancelSignal
): Promise<retroarch.RomMatchResult> => {
  const lookup = new Map<string, LaunchboxShopDetailsEntry>();
  let failed = false;

  const byPlatform = new Map<RetroArchPlatform, HashedRom[]>();
  for (const rom of hashed) {
    if (!rom.crc32) continue;
    const bucket = byPlatform.get(rom.platform) ?? [];
    bucket.push(rom);
    byPlatform.set(rom.platform, bucket);
  }

  for (const [platform, roms] of byPlatform) {
    if (signal.cancelled) break;
    const platformResult = await retroarch.fetchShopDetailsForHashes(
      platform,
      roms.map((rom) => ({
        crc32: rom.crc32!,
        fileName: rom.name,
        sizeBytes: rom.sizeBytes,
        serial: null,
      })),
      language
    );
    if (platformResult.failed) failed = true;
    for (const [hash, entry] of platformResult.lookup) {
      lookup.set(hash, entry);
    }
  }

  return { lookup, failed };
};

const ensureRomFolderRegistered = async (
  folderPath: string,
  scanSubfolders: boolean
) => {
  await retroarch.updateRetroArchConfig((current) => {
    if (current.romFolders.some((f) => f.path === folderPath)) return current;

    const folder: RomFolder = {
      id: randomUUID(),
      path: folderPath,
      scanSubfolders,
      fileCount: 0,
      sizeBytes: 0,
      lastScanAt: null,
    };

    return retroarch.recomputeRetroArchTotals({
      ...current,
      romFolders: [...current.romFolders, folder],
    });
  });
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

const sumDiscSizes = async (discs: ClassicsDisc[]): Promise<number | null> => {
  let total = 0;
  let counted = 0;

  for (const disc of discs) {
    try {
      const { size } = await stat(disc.path);
      total += size;
      counted += 1;
    } catch {
      continue;
    }
  }

  return counted > 0 ? total : null;
};

const applyReconciliation = async (
  key: string,
  game: Game,
  reconciled: DiscReconciliation,
  errorMessage: string
): Promise<void> => {
  if (reconciled.isDeleted) {
    game.isDeleted = true;
  } else {
    game.discs = reconciled.discs;
    game.selectedDiscPath = reconciled.selectedDiscPath;
    game.romSizeBytes = await sumDiscSizes(reconciled.discs);
  }

  await gamesSublevel.put(key, game).catch((err) => {
    logger.error(errorMessage, err);
  });
};

export const reconcileRemovedRetroArchFolder = async (
  removedPath: string,
  remainingFolderPaths: string[]
): Promise<void> => {
  const entries = await gamesSublevel.iterator().all();
  for (const [key, game] of entries) {
    if (game.isDeleted) continue;
    if (game.shop !== "launchbox") continue;
    if (!platformToRetroArchPlatform(game.platform)) continue;

    const reconciled = reconcileDiscsForRemovedFolder(
      game.discs ?? [],
      game.selectedDiscPath,
      removedPath,
      remainingFolderPaths
    );
    if (!reconciled) continue;

    await applyReconciliation(
      key,
      game,
      reconciled,
      "Could not reconcile removed RetroArch folder entry"
    );
  }
};

const reconcileDeletedGames = async (folders: FolderInput[]) => {
  const entries = await gamesSublevel.iterator().all();
  for (const [key, game] of entries) {
    if (game.isDeleted) continue;
    if (game.shop !== "launchbox") continue;
    if (!platformToRetroArchPlatform(game.platform)) continue;

    const reconciled = reconcileDiscsAfterScan(
      game.discs ?? [],
      game.selectedDiscPath,
      folders.map((folder) => folder.path),
      existsSync
    );
    if (!reconciled) continue;

    await applyReconciliation(
      key,
      game,
      reconciled,
      "Could not mark stale RetroArch game as deleted"
    );
  }
};

interface TitleInfo {
  folderPath: string;
  sizeBytes: number;
  platform: RetroArchPlatform;
}

interface AggregatedMatches {
  matchedEntries: Map<string, LaunchboxShopDetailsEntry>;
  discsByTitle: Map<string, { primaryPath: string; name: string }[]>;
  titleInfo: Map<string, TitleInfo>;
  unmatchedFiles: RetroArchUnmatchedFile[];
}

const recordMatchedRom = (
  aggregated: AggregatedMatches,
  rom: HashedRom,
  entry: LaunchboxShopDetailsEntry
): void => {
  aggregated.matchedEntries.set(entry.objectId, entry);

  const discs = aggregated.discsByTitle.get(entry.objectId) ?? [];
  const isNewDisc = !discs.some((d) => d.primaryPath === rom.primaryPath);
  if (isNewDisc) {
    discs.push({ primaryPath: rom.primaryPath, name: rom.name });
  }
  aggregated.discsByTitle.set(entry.objectId, discs);

  if (!isNewDisc) return;

  const info = aggregated.titleInfo.get(entry.objectId);
  if (info) {
    info.sizeBytes += rom.sizeBytes;
  } else {
    aggregated.titleInfo.set(entry.objectId, {
      folderPath: rom.folderPath,
      sizeBytes: rom.sizeBytes,
      platform: rom.platform,
    });
  }
};

const aggregateMatches = (
  hashed: HashedRom[],
  lookup: Map<string, LaunchboxShopDetailsEntry>,
  signal: CancelSignal,
  onMatch?: (
    processed: number,
    currentFile: string,
    status: "matched" | "unmatched",
    matched: number,
    sizeBytes: number
  ) => void
): AggregatedMatches => {
  const aggregated: AggregatedMatches = {
    matchedEntries: new Map(),
    discsByTitle: new Map(),
    titleInfo: new Map(),
    unmatchedFiles: [],
  };
  let matchedSizeBytes = 0;

  for (let i = 0; i < hashed.length; i++) {
    if (signal.cancelled) break;
    const rom = hashed[i];
    const entry = rom.crc32 ? (lookup.get(rom.crc32) ?? null) : null;

    if (entry?.objectId && entry.data) {
      recordMatchedRom(aggregated, rom, entry);
      matchedSizeBytes += rom.sizeBytes;
    } else {
      aggregated.unmatchedFiles.push({ name: rom.name, reason: "unmatched" });
    }

    onMatch?.(
      i + 1,
      rom.name,
      entry ? "matched" : "unmatched",
      aggregated.matchedEntries.size,
      matchedSizeBytes
    );
  }

  return aggregated;
};

const computeFolderRollups = (
  folders: FolderInput[],
  titleInfo: Map<string, TitleInfo>
): {
  folderRollup: Map<string, { fileCount: number; sizeBytes: number }>;
  totalFileCount: number;
  totalSizeBytes: number;
} => {
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

  return { folderRollup, totalFileCount, totalSizeBytes };
};

const persistMatchedTitles = async (
  aggregated: AggregatedMatches,
  language: string
): Promise<void> => {
  for (const entry of aggregated.matchedEntries.values()) {
    const titleDiscs = aggregated.discsByTitle.get(entry.objectId) ?? [];
    const discs = buildRomDiscList(titleDiscs);
    const info = aggregated.titleInfo.get(entry.objectId);
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
};

async function runRetroArchImport(
  folders: FolderInput[],
  language: string,
  signal: CancelSignal,
  onProgress?: ProgressFn
): Promise<RetroArchImportResult> {
  // Register the folders up front with empty counts. A cancelled scan returns
  // before the rollup is persisted, and the user still expects the folder they
  // picked to be listed - just with no games detected yet.
  for (const folder of folders) {
    await ensureRomFolderRegistered(folder.path, folder.scanSubfolders);
  }

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

  const { lookup, failed: matchFailed } = await matchRoms(
    hashed,
    language,
    signal
  );
  if (signal.cancelled) return cancelledResult();

  const aggregated = aggregateMatches(
    hashed,
    lookup,
    signal,
    (processed, currentFile, status, matched, sizeBytes) =>
      onProgress?.({
        type: "progress",
        phase: "matching",
        processed,
        total: hashed.length,
        percent: bandPercent(
          SCAN_BAND + HASH_BAND,
          100 - (SCAN_BAND + HASH_BAND),
          processed,
          hashed.length
        ),
        currentFile,
        status,
        discovered: totalGames,
        matched,
        sizeBytes,
      })
  );

  const byPlatform: Partial<
    Record<RetroArchPlatform, { discovered: number; matched: number }>
  > = {};
  for (const rom of hashed) {
    const tally = byPlatform[rom.platform] ?? { discovered: 0, matched: 0 };
    tally.discovered += 1;
    if (rom.crc32 && lookup.has(rom.crc32)) tally.matched += 1;
    byPlatform[rom.platform] = tally;
  }
  const unmatchedSample = hashed
    .filter((rom) => !rom.crc32 || !lookup.has(rom.crc32))
    .slice(0, 25)
    .map((rom) => ({
      name: rom.name,
      crc32: rom.crc32,
      platform: rom.platform,
    }));
  logger.info("RetroArch import summary", {
    discovered: totalGames,
    hashed: hashed.filter((rom) => rom.crc32).length,
    matchedTitles: aggregated.matchedEntries.size,
    unmatched: aggregated.unmatchedFiles.length,
    matchFailed,
    byPlatform,
    unmatchedSample,
  });

  const { folderRollup, totalFileCount, totalSizeBytes } = computeFolderRollups(
    folders,
    aggregated.titleInfo
  );

  const asCancelled = () =>
    cancelledResult(
      totalFileCount,
      totalSizeBytes,
      aggregated.matchedEntries.size,
      aggregated.unmatchedFiles.length,
      aggregated.unmatchedFiles
    );

  if (signal.cancelled) return asCancelled();

  await persistMatchedTitles(aggregated, language);
  if (matchFailed) {
    const config = await retroarch.getRetroArchConfig();
    const foldersWithoutTotals = folders.filter(
      (folder) =>
        (config.romFolders.find((known) => known.path === folder.path)
          ?.fileCount ?? 0) === 0
    );

    if (foldersWithoutTotals.length > 0) {
      await persistFolderRollups(foldersWithoutTotals, folderRollup);
    }

    logger.warn(
      "Keeping previous RetroArch folder totals after a failed match",
      {
        folders: folders
          .filter((folder) => !foldersWithoutTotals.includes(folder))
          .map((folder) => folder.path),
      }
    );
  } else {
    await persistFolderRollups(folders, folderRollup);
  }
  await reconcileDeletedGames(folders);
  await recomputeRetroArchPlatformCounts();
  await syncProfileBatch(Array.from(aggregated.matchedEntries.keys()));

  return {
    fileCount: totalFileCount,
    sizeBytes: totalSizeBytes,
    matched: aggregated.matchedEntries.size,
    unmatched: aggregated.unmatchedFiles.length,
    unmatchedFiles: aggregated.unmatchedFiles,
    cancelled: false,
  };
}

const RETROARCH_IMPORT_PROGRESS_CHANNEL = "on-retroarch-import-progress";

interface TrackedRetroArchImport {
  requestId: string;
  signal: CancelSignal;
  done: Promise<RetroArchImportResult | null>;
}

let activeImport: TrackedRetroArchImport | null = null;

export const startTrackedRetroArchImport = (
  folders: FolderInput[],
  language: string
): TrackedRetroArchImport => {
  if (activeImport) return activeImport;

  const requestId = randomUUID();
  const signal: CancelSignal = { cancelled: false };
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

  const done = (async () => {
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
      return result;
    } catch (err) {
      WindowManager.sendToAppWindows(RETROARCH_IMPORT_PROGRESS_CHANNEL, {
        type: "error",
        requestId,
        message: err instanceof Error ? err.message : String(err),
      });
      return null;
    } finally {
      inflight.delete(requestId);
      activeImport = null;
      setActiveRetroArchImport(null);
      WindowManager.sendToAppWindows("on-retroarch-import-status", false);
    }
  })();

  const tracked: TrackedRetroArchImport = { requestId, signal, done };
  activeImport = tracked;
  return tracked;
};

const importRetroArchRoms = async (
  _event: Electron.IpcMainInvokeEvent,
  folders: FolderInput[],
  language: string
) => {
  const { requestId } = startTrackedRetroArchImport(folders, language);
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
