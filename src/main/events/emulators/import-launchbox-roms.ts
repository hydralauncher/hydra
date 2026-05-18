import { randomUUID } from "node:crypto";
import { chunk } from "lodash-es";

import { registerEvent } from "../register-event";
import { HydraApi, WindowManager, emulators, logger } from "@main/services";
import {
  downloadsSublevel,
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import type {
  ClassicsDisc,
  EmulatorSystem,
  RomFolder,
  ShopAssets,
  ShopDetails,
} from "@types";

interface FolderInput {
  path: string;
  scanSubfolders: boolean;
}

interface LaunchboxShopDetailsAssetsResponse {
  objectId: string;
  shop: "launchbox";
  title: string;
  iconUrl: string | null;
  libraryHeroImageUrl: string | null;
  libraryImageUrl: string | null;
  logoImageUrl: string | null;
}

interface LaunchboxShopDetailsEntry {
  objectId: string;
  shop: "launchbox";
  platform?: string | null;
  skus?: string[];
  matchedSkus?: string[];
  data: {
    title: string;
    platform?: string | null;
    description?: string | null;
    releaseDate?: string | null;
    developers?: string[];
    publishers?: string[];
    genres?: string[];
    headerImage?: string | null;
    website?: string | null;
    screenshots?: string[];
    assets?: LaunchboxShopDetailsAssetsResponse | null;
  } | null;
}

const SHOP_DETAILS_CHUNK_SIZE = 100;
const PROFILE_BATCH_CHUNK_SIZE = 100;

const inflight = new Map<string, { cancelled: boolean }>();

const normalizeSku = (raw: string): string =>
  raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

const mapToShopDetails = (
  objectId: string,
  entry: LaunchboxShopDetailsEntry
): ShopDetails => {
  const data = entry.data;
  const description = data?.description ?? "";
  return {
    objectId,
    name: data?.title ?? "",
    platform: entry.platform ?? data?.platform ?? undefined,
    skus: entry.skus ?? undefined,
    steam_appid: 0,
    detailed_description: description,
    about_the_game: description,
    short_description: "",
    publishers: data?.publishers ?? [],
    genres: (data?.genres ?? []).map((name, index) => ({
      id: String(index),
      name,
    })),
    movies: undefined,
    supported_languages: "",
    screenshots: (data?.screenshots ?? []).map((url, index) => ({
      id: index,
      path_thumbnail: url,
      path_full: url,
    })),
    pc_requirements: { minimum: "", recommended: "" },
    mac_requirements: { minimum: "", recommended: "" },
    linux_requirements: { minimum: "", recommended: "" },
    release_date: {
      coming_soon: false,
      date: data?.releaseDate ?? "",
    },
    content_descriptors: { ids: [] },
  };
};

const DISC_LABEL_REGEX = /\b(?:disc|cd|disk)\s*([0-9]+)\b/i;

const parseDiscNumber = (fileName: string): number | null => {
  const match = DISC_LABEL_REGEX.exec(fileName);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  return Number.isFinite(num) ? num : null;
};

const baseNameWithoutExt = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};

const buildDiscList = (
  files: { primaryPath: string; name: string }[]
): ClassicsDisc[] => {
  const sorted = [...files].sort((a, b) => {
    const ad = parseDiscNumber(a.name);
    const bd = parseDiscNumber(b.name);
    if (ad !== null && bd !== null) return ad - bd;
    if (ad !== null) return -1;
    if (bd !== null) return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return sorted.map((f, index) => {
    const detected = parseDiscNumber(f.name);
    const discNumber = detected ?? index + 1;
    const label =
      detected !== null || sorted.length > 1
        ? `Disc ${discNumber}`
        : baseNameWithoutExt(f.name);
    return {
      path: f.primaryPath,
      label,
      fileName: f.name,
    };
  });
};

const persistEntryLocally = async (
  entry: LaunchboxShopDetailsEntry,
  language: string,
  discs: ClassicsDisc[]
) => {
  const shop = "launchbox" as const;
  const objectId = entry.objectId;
  const gameKey = levelKeys.game(shop, objectId);
  const cacheKey = levelKeys.gameShopCacheItem(shop, objectId, language);

  const shopDetails = mapToShopDetails(objectId, entry);
  await gamesShopCacheSublevel.put(cacheKey, shopDetails).catch((err) => {
    logger.error("Could not cache launchbox shop details", err);
  });

  const assetsSource = entry.data?.assets;
  const fallbackTitle = entry.data?.title ?? "";
  const assets: ShopAssets = {
    objectId,
    shop,
    title: assetsSource?.title ?? fallbackTitle,
    iconUrl: assetsSource?.iconUrl ?? null,
    libraryHeroImageUrl: assetsSource?.libraryHeroImageUrl ?? null,
    libraryImageUrl: assetsSource?.libraryImageUrl ?? null,
    logoImageUrl: assetsSource?.logoImageUrl ?? null,
    logoPosition: null,
    coverImageUrl: null,
    downloadSources: [],
  };

  await gamesShopAssetsSublevel
    .put(levelKeys.game(shop, objectId), { ...assets, updatedAt: Date.now() })
    .catch((err) => {
      logger.error("Could not cache launchbox assets", err);
    });

  const platform = entry.platform ?? entry.data?.platform ?? null;

  const existing = await gamesSublevel.get(gameKey);
  if (existing) {
    await downloadsSublevel.del(gameKey).catch(() => {});
    existing.isDeleted = false;
    existing.addedToLibraryAt ??= new Date();
    if (platform && !existing.platform) {
      existing.platform = platform;
    }
    existing.discs = discs;
    if (
      !existing.selectedDiscPath ||
      !discs.some((d) => d.path === existing.selectedDiscPath)
    ) {
      existing.selectedDiscPath = discs[0]?.path ?? null;
    }
    await gamesSublevel.put(gameKey, existing);
  } else {
    await gamesSublevel.put(gameKey, {
      title: entry.data?.title ?? assets.title,
      iconUrl: assets.iconUrl,
      libraryHeroImageUrl: assets.libraryHeroImageUrl,
      logoImageUrl: assets.logoImageUrl,
      objectId,
      shop,
      remoteId: null,
      isDeleted: false,
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
      addedToLibraryAt: new Date(),
      platform,
      discs,
      selectedDiscPath: discs[0]?.path ?? null,
    });
  }

  AchievementWatcherManager.firstSyncWithRemoteIfNeeded(shop, objectId);
};

const fetchShopDetailsForSkus = async (
  skus: string[]
): Promise<Map<string, LaunchboxShopDetailsEntry>> => {
  const lookup = new Map<string, LaunchboxShopDetailsEntry>();
  if (skus.length === 0) return lookup;

  const chunks = chunk(skus, SHOP_DETAILS_CHUNK_SIZE);
  for (const skuChunk of chunks) {
    try {
      const response = await HydraApi.post<LaunchboxShopDetailsEntry[]>(
        "/games/shop-details",
        { shop: "launchbox", skus: skuChunk },
        { needsAuth: false }
      );
      if (!Array.isArray(response)) continue;

      for (const entry of response) {
        if (!entry?.objectId || !entry.data) continue;
        const entrySkus = entry.skus ?? entry.matchedSkus ?? [];
        for (const matchedSku of entrySkus) {
          lookup.set(normalizeSku(matchedSku), entry);
        }
      }
    } catch (err) {
      logger.error("Failed to fetch launchbox shop-details batch", err);
    }
  }
  return lookup;
};

const syncProfileBatch = async (objectIds: string[]) => {
  if (objectIds.length === 0) return;

  const chunks = chunk(objectIds, PROFILE_BATCH_CHUNK_SIZE);
  for (const objectIdChunk of chunks) {
    const payload = objectIdChunk.map((objectId) => ({
      objectId,
      shop: "launchbox",
      playTimeInMilliseconds: 0,
      lastTimePlayed: null,
    }));
    try {
      await HydraApi.post("/profile/games/batch", payload);
    } catch (err) {
      logger.error("Failed to batch-sync launchbox games to profile", err);
    }
  }
};

const persistRomFolder = async (
  system: EmulatorSystem,
  folderPath: string,
  scanSubfolders: boolean,
  fileCount: number,
  sizeBytes: number
) => {
  await emulators.updateEmulatorConfig(system, (current) => {
    const existing = current.romFolders.find((f) => f.path === folderPath);
    const updated: RomFolder = {
      id: existing?.id ?? randomUUID(),
      path: folderPath,
      scanSubfolders,
      fileCount,
      sizeBytes,
      lastScanAt: Date.now(),
    };

    const nextFolders = existing
      ? current.romFolders.map((f) => (f.path === folderPath ? updated : f))
      : [...current.romFolders, updated];

    return emulators.recomputeTotals({
      ...current,
      romFolders: nextFolders,
    });
  });
};

export type LaunchboxImportProgress =
  | {
      type: "scan_progress";
      phase: "scanning";
      processed: number;
      total: number;
      currentFile: string | null;
    }
  | {
      type: "match_progress";
      phase: "matching";
      processed: number;
      total: number;
      currentFile: string;
      status: "matched" | "unmatched";
      matched: number;
      unmatched: number;
      fileCount: number;
      sizeBytes: number;
    };

export interface LaunchboxImportResult {
  fileCount: number;
  sizeBytes: number;
  matched: number;
  unmatched: number;
  cancelled: boolean;
}

export async function runLaunchboxImport(
  system: EmulatorSystem,
  folders: FolderInput[],
  language: string,
  signal: { cancelled: boolean },
  onProgress?: (payload: LaunchboxImportProgress) => void
): Promise<LaunchboxImportResult> {
  const binary = emulators.KNOWN_BINARIES[system];

  type ScannedGameInfo = {
    folderPath: string;
    primaryPath: string;
    name: string;
    sizeBytes: number;
  };

  const collected: ScannedGameInfo[] = [];

  // Phase 1: scan folders (defer persistence until grouping is known)
  for (const folder of folders) {
    if (signal.cancelled) break;

    const partial = await emulators.scanRomFolder(
      folder.path,
      binary,
      folder.scanSubfolders,
      {
        signal,
        onProgress: (p) => {
          onProgress?.({
            type: "scan_progress",
            phase: "scanning",
            processed: p.processed,
            total: p.total,
            currentFile: p.currentFile,
          });
        },
      }
    );

    for (const game of partial.games) {
      collected.push({ folderPath: folder.path, ...game });
    }
  }

  const folderInputBy = new Map(folders.map((f) => [f.path, f]));

  if (signal.cancelled) {
    return {
      fileCount: 0,
      sizeBytes: 0,
      matched: 0,
      unmatched: 0,
      cancelled: true,
    };
  }

  // Phase 2: extract SKU per game
  const totalGames = collected.length;
  const gameSkus: { game: ScannedGameInfo; sku: string | null }[] = [];

  for (let i = 0; i < collected.length; i++) {
    if (signal.cancelled) break;
    const game = collected[i];
    const sku = await emulators.extractDiscSku(game.primaryPath, system);
    gameSkus.push({ game, sku });
  }

  if (signal.cancelled) {
    return {
      fileCount: 0,
      sizeBytes: 0,
      matched: 0,
      unmatched: 0,
      cancelled: true,
    };
  }

  // Phase 3: batch fetch shop-details for unique SKUs
  const uniqueSkus = Array.from(
    new Set(
      gameSkus
        .map((g) => g.sku)
        .filter((s): s is string => s !== null && s.length > 0)
    )
  );
  const skuLookup = await fetchShopDetailsForSkus(uniqueSkus);

  if (signal.cancelled) {
    return {
      fileCount: 0,
      sizeBytes: 0,
      matched: 0,
      unmatched: 0,
      cancelled: true,
    };
  }

  // Phase 4: per-game match progress + collect unique matched entries
  let unmatched = 0;
  const matchedEntries = new Map<string, LaunchboxShopDetailsEntry>();
  // titleKey -> per-folder rollup: aggregates size across all discs of the
  // same title and pins it to the folder of the first disc encountered.
  const titleByFolder = new Map<
    string,
    { folderPath: string; sizeBytes: number }
  >();
  const discsByTitle = new Map<
    string,
    { primaryPath: string; name: string }[]
  >();

  for (let i = 0; i < gameSkus.length; i++) {
    if (signal.cancelled) break;
    const { game, sku } = gameSkus[i];
    const entry = sku ? (skuLookup.get(normalizeSku(sku)) ?? null) : null;
    const success = Boolean(entry?.objectId && entry?.data);

    const titleKey = success && entry ? entry.objectId : game.primaryPath;
    const existing = titleByFolder.get(titleKey);
    if (existing) {
      existing.sizeBytes += game.sizeBytes;
    } else {
      titleByFolder.set(titleKey, {
        folderPath: game.folderPath,
        sizeBytes: game.sizeBytes,
      });
    }

    const discsForTitle = discsByTitle.get(titleKey) ?? [];
    if (!discsForTitle.some((d) => d.primaryPath === game.primaryPath)) {
      discsForTitle.push({ primaryPath: game.primaryPath, name: game.name });
    }
    discsByTitle.set(titleKey, discsForTitle);

    if (success && entry) {
      if (!matchedEntries.has(entry.objectId)) {
        matchedEntries.set(entry.objectId, entry);
      }
    } else {
      unmatched += 1;
    }

    const totalUniqueTitlesSoFar = titleByFolder.size;
    let totalSizeSoFar = 0;
    for (const v of titleByFolder.values()) totalSizeSoFar += v.sizeBytes;

    onProgress?.({
      type: "match_progress",
      phase: "matching",
      processed: i + 1,
      total: totalGames,
      currentFile: game.name,
      status: success ? "matched" : "unmatched",
      matched: matchedEntries.size,
      unmatched,
      fileCount: totalUniqueTitlesSoFar,
      sizeBytes: totalSizeSoFar,
    });
  }

  const matched = matchedEntries.size;

  // Roll up per-folder unique-title counts and sizes
  const folderRollup = new Map<
    string,
    { fileCount: number; sizeBytes: number }
  >();
  for (const folder of folders) {
    folderRollup.set(folder.path, { fileCount: 0, sizeBytes: 0 });
  }
  for (const { folderPath, sizeBytes } of titleByFolder.values()) {
    const bucket = folderRollup.get(folderPath);
    if (bucket) {
      bucket.fileCount += 1;
      bucket.sizeBytes += sizeBytes;
    }
  }

  const totalFileCount = Array.from(folderRollup.values()).reduce(
    (s, b) => s + b.fileCount,
    0
  );
  const totalSizeBytes = Array.from(folderRollup.values()).reduce(
    (s, b) => s + b.sizeBytes,
    0
  );

  if (signal.cancelled) {
    return {
      fileCount: totalFileCount,
      sizeBytes: totalSizeBytes,
      matched,
      unmatched,
      cancelled: true,
    };
  }

  // Phase 5: persist unique matched entries locally
  for (const entry of matchedEntries.values()) {
    if (signal.cancelled) break;
    const titleDiscs = discsByTitle.get(entry.objectId) ?? [];
    const discs = buildDiscList(titleDiscs);
    await persistEntryLocally(entry, language, discs).catch((err) => {
      logger.error("Failed to persist launchbox entry locally", err);
    });
  }

  // Phase 6: persist rom folders with grouped counts
  for (const [folderPath, rollup] of folderRollup) {
    const input = folderInputBy.get(folderPath);
    if (!input) continue;
    await persistRomFolder(
      system,
      input.path,
      input.scanSubfolders,
      rollup.fileCount,
      rollup.sizeBytes
    ).catch((err) => {
      logger.error("Could not persist rom folder", err);
    });
  }

  // Phase 7: batch sync to remote profile
  const matchedObjectIds = Array.from(matchedEntries.keys());
  await syncProfileBatch(matchedObjectIds);

  return {
    fileCount: totalFileCount,
    sizeBytes: totalSizeBytes,
    matched,
    unmatched,
    cancelled: signal.cancelled,
  };
}

const importLaunchboxRoms = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  folders: FolderInput[],
  language: string
) => {
  const requestId = randomUUID();
  const signal = { cancelled: false };
  inflight.set(requestId, signal);

  const channel = `on-launchbox-import-progress-${requestId}`;

  void (async () => {
    try {
      const result = await runLaunchboxImport(
        system,
        folders,
        language,
        signal,
        (payload) => {
          WindowManager.mainWindow?.webContents.send(channel, payload);
        }
      );

      WindowManager.mainWindow?.webContents.send(channel, {
        type: result.cancelled ? "cancelled" : "done",
        fileCount: result.fileCount,
        sizeBytes: result.sizeBytes,
        matched: result.matched,
        unmatched: result.unmatched,
      });
    } catch (err) {
      WindowManager.mainWindow?.webContents.send(channel, {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inflight.delete(requestId);
    }
  })();

  return { requestId };
};

const cancelLaunchboxImport = async (
  _event: Electron.IpcMainInvokeEvent,
  requestId: string
) => {
  const signal = inflight.get(requestId);
  if (signal) signal.cancelled = true;
};

registerEvent("importLaunchboxRoms", importLaunchboxRoms);
registerEvent("cancelLaunchboxImport", cancelLaunchboxImport);
