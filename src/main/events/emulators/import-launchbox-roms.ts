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

const persistEntryLocally = async (
  entry: LaunchboxShopDetailsEntry,
  language: string
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

  const existing = await gamesSublevel.get(gameKey);
  if (existing) {
    await downloadsSublevel.del(gameKey).catch(() => {});
    existing.isDeleted = false;
    existing.addedToLibraryAt ??= new Date();
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
  const binary = emulators.KNOWN_BINARIES[system];

  void (async () => {
    try {
      type ScannedGameInfo = {
        primaryPath: string;
        name: string;
        sizeBytes: number;
      };

      const collected: ScannedGameInfo[] = [];
      let totalFileCount = 0;
      let totalSizeBytes = 0;

      // Phase 1: scan folders, persist rom folders
      for (const folder of folders) {
        if (signal.cancelled) break;

        const partial = await emulators.scanRomFolder(
          folder.path,
          binary,
          folder.scanSubfolders,
          {
            signal,
            onProgress: (p) => {
              WindowManager.mainWindow?.webContents.send(channel, {
                type: "scan_progress",
                phase: "scanning",
                processed: p.processed,
                total: p.total,
                currentFile: p.currentFile,
              });
            },
          }
        );

        totalFileCount += partial.fileCount;
        totalSizeBytes += partial.sizeBytes;
        collected.push(...partial.games);

        await persistRomFolder(
          system,
          folder.path,
          folder.scanSubfolders,
          partial.fileCount,
          partial.sizeBytes
        ).catch((err) => {
          logger.error("Could not persist rom folder", err);
        });
      }

      if (signal.cancelled) {
        WindowManager.mainWindow?.webContents.send(channel, {
          type: "cancelled",
          fileCount: totalFileCount,
          sizeBytes: totalSizeBytes,
          matched: 0,
          unmatched: 0,
        });
        return;
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
        WindowManager.mainWindow?.webContents.send(channel, {
          type: "cancelled",
          fileCount: totalFileCount,
          sizeBytes: totalSizeBytes,
          matched: 0,
          unmatched: 0,
        });
        return;
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
        WindowManager.mainWindow?.webContents.send(channel, {
          type: "cancelled",
          fileCount: totalFileCount,
          sizeBytes: totalSizeBytes,
          matched: 0,
          unmatched: 0,
        });
        return;
      }

      // Phase 4: per-game match progress + collect unique matched entries
      let matched = 0;
      let unmatched = 0;
      const matchedEntries = new Map<string, LaunchboxShopDetailsEntry>();

      for (let i = 0; i < gameSkus.length; i++) {
        if (signal.cancelled) break;
        const { game, sku } = gameSkus[i];
        const entry = sku ? (skuLookup.get(normalizeSku(sku)) ?? null) : null;
        const success = Boolean(entry?.objectId && entry?.data);

        if (success && entry) {
          matched += 1;
          if (!matchedEntries.has(entry.objectId)) {
            matchedEntries.set(entry.objectId, entry);
          }
        } else {
          unmatched += 1;
        }

        WindowManager.mainWindow?.webContents.send(channel, {
          type: "match_progress",
          phase: "matching",
          processed: i + 1,
          total: totalGames,
          currentFile: game.name,
          status: success ? "matched" : "unmatched",
          matched,
          unmatched,
          fileCount: totalFileCount,
          sizeBytes: totalSizeBytes,
        });
      }

      if (signal.cancelled) {
        WindowManager.mainWindow?.webContents.send(channel, {
          type: "cancelled",
          fileCount: totalFileCount,
          sizeBytes: totalSizeBytes,
          matched,
          unmatched,
        });
        return;
      }

      // Phase 5: persist unique matched entries locally
      for (const entry of matchedEntries.values()) {
        if (signal.cancelled) break;
        await persistEntryLocally(entry, language).catch((err) => {
          logger.error("Failed to persist launchbox entry locally", err);
        });
      }

      // Phase 6: batch sync to remote profile
      const matchedObjectIds = Array.from(matchedEntries.keys());
      await syncProfileBatch(matchedObjectIds);

      WindowManager.mainWindow?.webContents.send(channel, {
        type: signal.cancelled ? "cancelled" : "done",
        fileCount: totalFileCount,
        sizeBytes: totalSizeBytes,
        matched,
        unmatched,
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
