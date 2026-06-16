import { randomUUID } from "node:crypto";
import path from "node:path";
import { chunk } from "lodash-es";

import { registerEvent } from "../register-event";
import { HydraApi, WindowManager, emulators, logger } from "@main/services";
import {
  fetchShopDetailsForSkus,
  normalizeSku,
  type LaunchboxShopDetailsEntry,
} from "@main/services/emulators";
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

const PROFILE_BATCH_CHUNK_SIZE = 100;

const inflight = new Map<string, { cancelled: boolean }>();

const lookupYmlSku = (
  index: Map<string, string>,
  primaryPath: string
): string | null => {
  const norm = path.normalize(primaryPath).replace(/[\\/]+$/, "");
  return (
    index.get(norm) ??
    index.get(path.basename(norm)) ??
    index.get(path.basename(path.dirname(norm))) ??
    null
  );
};

const ymlValueForGame = (primaryPath: string): string =>
  path.basename(primaryPath).toUpperCase() === "PS3_GAME"
    ? path.dirname(primaryPath)
    : primaryPath;

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
    developers: data?.developers ?? [],
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

const DISC_LABEL_REGEX = /\b(?:disc|cd|disk)\s*(\d+)\b/i;

const parseDiscNumber = (fileName: string): number | null => {
  const match = DISC_LABEL_REGEX.exec(fileName);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  return Number.isFinite(num) ? num : null;
};

// Strips disc markers from a filename so multi-disc siblings collapse to the
// same key. Handles "(Disc 1)", "[CD 2]", "(Disc 1 of 3)", " - Disc 1",
// " Disc 1".
const stripDiscMarker = (fileName: string): string => {
  const base = fileName.replace(/\.[^.]+$/, "");
  return base
    .replace(/\s*[([][^()\]]*?(?:disc|cd|disk)\s*\d+[^()\]]*?[)\]]/gi, "")
    .replace(/\s*-\s*(?:disc|cd|disk)\s*\d+\b/gi, "")
    .replace(/\s+(?:disc|cd|disk)\s*\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
};

const baseNameWithoutExt = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};

const buildDiscList = (
  files: { primaryPath: string; name: string; sku: string | null }[]
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
      sku: f.sku,
    };
  });
};

const SYSTEM_DEFAULT_PLATFORM: Record<EmulatorSystem, string> = {
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
};

const persistEntryLocally = async (
  entry: LaunchboxShopDetailsEntry,
  language: string,
  discs: ClassicsDisc[],
  system: EmulatorSystem
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

  const platform =
    entry.platform ??
    entry.data?.platform ??
    SYSTEM_DEFAULT_PLATFORM[system] ??
    null;

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
  unmatchedFiles: string[];
  cancelled: boolean;
}

type ScannedGameInfo = {
  folderPath: string;
  primaryPath: string;
  name: string;
  sizeBytes: number;
};

interface GameSku {
  game: ScannedGameInfo;
  sku: string | null;
}

interface EnrichedGame {
  game: ScannedGameInfo;
  sku: string | null;
  entry: LaunchboxShopDetailsEntry | null;
  groupKey: string;
}

type SkuLookup = Awaited<ReturnType<typeof fetchShopDetailsForSkus>>;
type TitleByFolder = Map<string, { folderPath: string; sizeBytes: number }>;
type DiscsByTitle = Map<
  string,
  { primaryPath: string; name: string; sku: string | null }[]
>;
type CancelSignal = { cancelled: boolean };
type ProgressFn = (payload: LaunchboxImportProgress) => void;

const cancelledResult = (
  fileCount = 0,
  sizeBytes = 0,
  matched = 0,
  unmatched = 0,
  unmatchedFiles: string[] = []
): LaunchboxImportResult => ({
  fileCount,
  sizeBytes,
  matched,
  unmatched,
  unmatchedFiles,
  cancelled: true,
});

const scanFolders = async (
  system: EmulatorSystem,
  folders: FolderInput[],
  signal: CancelSignal,
  onProgress?: ProgressFn
): Promise<ScannedGameInfo[]> => {
  const binary = emulators.KNOWN_BINARIES[system];
  const collected: ScannedGameInfo[] = [];

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

  return collected;
};

const resolveSkus = async (
  system: EmulatorSystem,
  collected: ScannedGameInfo[],
  signal: CancelSignal
): Promise<{
  gameSkus: GameSku[];
  ps3Exe: string | null;
  ps3ExtractedForYml: Map<string, string>;
}> => {
  const gameSkus: GameSku[] = [];
  const ps3ExtractedForYml = new Map<string, string>();
  let ps3Exe: string | null = null;
  let ps3PathIndex: Map<string, string> | null = null;

  if (system === "ps3") {
    const cfg = await emulators.getEmulatorConfig("ps3");
    ps3Exe = cfg.executablePath;
    ps3PathIndex = emulators.buildPathToTitleIdIndex(
      await emulators.readGamesYml(ps3Exe)
    );
  }

  for (const game of collected) {
    if (signal.cancelled) break;

    let sku = ps3PathIndex
      ? lookupYmlSku(ps3PathIndex, game.primaryPath)
      : null;
    const fromYml = sku !== null;
    if (!sku) {
      sku = await emulators.extractDiscSku(game.primaryPath, system);
      if (system === "ps3" && sku) {
        ps3ExtractedForYml.set(
          normalizeSku(sku),
          ymlValueForGame(game.primaryPath)
        );
      }
    }

    logger.log("[launchbox-import] SKU extract", {
      system,
      file: game.primaryPath,
      sku,
      source: fromYml ? "games.yml" : "disc",
    });
    gameSkus.push({ game, sku });
  }

  return { gameSkus, ps3Exe, ps3ExtractedForYml };
};

const buildEnriched = (
  system: EmulatorSystem,
  gameSkus: GameSku[],
  skuLookup: SkuLookup
): {
  enriched: EnrichedGame[];
  groupCanonical: Map<string, LaunchboxShopDetailsEntry>;
} => {
  const enriched: EnrichedGame[] = gameSkus.map(({ game, sku }) => {
    const entry = sku ? (skuLookup.get(normalizeSku(sku)) ?? null) : null;
    const success = Boolean(entry?.objectId && entry?.data);
    const groupKey =
      system === "ps3"
        ? game.primaryPath
        : `${game.folderPath}::${stripDiscMarker(game.name)}`;
    logger.log("[launchbox-import] match", {
      file: game.primaryPath,
      sku,
      normalizedSku: sku ? normalizeSku(sku) : null,
      matched: success,
      objectId: success ? entry?.objectId : null,
      title: success ? entry?.data?.title : null,
      groupKey,
    });
    return { game, sku, entry: success ? entry : null, groupKey };
  });

  const groupCanonical = new Map<string, LaunchboxShopDetailsEntry>();
  for (const { entry, groupKey } of enriched) {
    if (entry && !groupCanonical.has(groupKey)) {
      groupCanonical.set(groupKey, entry);
    }
  }

  return { enriched, groupCanonical };
};

const aggregateMatches = (
  enriched: EnrichedGame[],
  groupCanonical: Map<string, LaunchboxShopDetailsEntry>,
  matchedCount: number,
  totalGames: number,
  signal: CancelSignal,
  onProgress?: ProgressFn
): {
  unmatched: number;
  unmatchedFiles: string[];
  titleByFolder: TitleByFolder;
  discsByTitle: DiscsByTitle;
} => {
  let unmatched = 0;
  const unmatchedFiles: string[] = [];
  const seenUnmatchedGroups = new Set<string>();
  const titleByFolder: TitleByFolder = new Map();
  const discsByTitle: DiscsByTitle = new Map();

  for (let i = 0; i < enriched.length; i++) {
    if (signal.cancelled) break;
    const { game, sku, groupKey } = enriched[i];
    const canonical = groupCanonical.get(groupKey);
    const titleKey = canonical ? canonical.objectId : groupKey;

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
      discsForTitle.push({
        primaryPath: game.primaryPath,
        name: game.name,
        sku,
      });
    }
    discsByTitle.set(titleKey, discsForTitle);

    if (!canonical && !seenUnmatchedGroups.has(groupKey)) {
      seenUnmatchedGroups.add(groupKey);
      unmatched += 1;
      unmatchedFiles.push(game.name);
    }

    let totalSizeSoFar = 0;
    for (const v of titleByFolder.values()) totalSizeSoFar += v.sizeBytes;

    onProgress?.({
      type: "match_progress",
      phase: "matching",
      processed: i + 1,
      total: totalGames,
      currentFile: game.name,
      status: canonical ? "matched" : "unmatched",
      matched: matchedCount,
      unmatched,
      fileCount: titleByFolder.size,
      sizeBytes: totalSizeSoFar,
    });
  }

  return { unmatched, unmatchedFiles, titleByFolder, discsByTitle };
};

const rollupFolders = (
  folders: FolderInput[],
  titleByFolder: TitleByFolder
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
  for (const { folderPath, sizeBytes } of titleByFolder.values()) {
    const bucket = folderRollup.get(folderPath);
    if (bucket) {
      bucket.fileCount += 1;
      bucket.sizeBytes += sizeBytes;
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

const persistMatchedEntries = async (
  matchedEntries: Map<string, LaunchboxShopDetailsEntry>,
  discsByTitle: DiscsByTitle,
  language: string,
  system: EmulatorSystem,
  signal: CancelSignal
) => {
  for (const entry of matchedEntries.values()) {
    if (signal.cancelled) break;
    const titleDiscs = discsByTitle.get(entry.objectId) ?? [];
    const discs = buildDiscList(titleDiscs);
    await persistEntryLocally(entry, language, discs, system).catch((err) => {
      logger.error("Failed to persist launchbox entry locally", err);
    });
  }
};

const persistFolderRollups = async (
  system: EmulatorSystem,
  folderRollup: Map<string, { fileCount: number; sizeBytes: number }>,
  folderInputBy: Map<string, FolderInput>
) => {
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
};

export async function runLaunchboxImport(
  system: EmulatorSystem,
  folders: FolderInput[],
  language: string,
  signal: CancelSignal,
  onProgress?: ProgressFn
): Promise<LaunchboxImportResult> {
  const folderInputBy = new Map(folders.map((f) => [f.path, f]));

  const collected = await scanFolders(system, folders, signal, onProgress);
  if (signal.cancelled) return cancelledResult();
  const totalGames = collected.length;

  const { gameSkus, ps3Exe, ps3ExtractedForYml } = await resolveSkus(
    system,
    collected,
    signal
  );
  if (signal.cancelled) return cancelledResult();

  const uniqueSkus = Array.from(
    new Set(
      gameSkus
        .map((g) => g.sku)
        .filter((s): s is string => s !== null && s.length > 0)
    )
  );
  const skuLookup = await fetchShopDetailsForSkus(uniqueSkus);
  if (signal.cancelled) return cancelledResult();

  const { enriched, groupCanonical } = buildEnriched(
    system,
    gameSkus,
    skuLookup
  );

  const matchedEntries = new Map<string, LaunchboxShopDetailsEntry>();
  for (const entry of groupCanonical.values()) {
    matchedEntries.set(entry.objectId, entry);
  }
  const matched = matchedEntries.size;

  const { unmatched, unmatchedFiles, titleByFolder, discsByTitle } =
    aggregateMatches(
      enriched,
      groupCanonical,
      matched,
      totalGames,
      signal,
      onProgress
    );

  const { folderRollup, totalFileCount, totalSizeBytes } = rollupFolders(
    folders,
    titleByFolder
  );

  if (signal.cancelled) {
    return cancelledResult(
      totalFileCount,
      totalSizeBytes,
      matched,
      unmatched,
      unmatchedFiles
    );
  }

  await persistMatchedEntries(
    matchedEntries,
    discsByTitle,
    language,
    system,
    signal
  );
  await persistFolderRollups(system, folderRollup, folderInputBy);
  await syncProfileBatch(Array.from(matchedEntries.keys()));

  if (system === "ps3" && !signal.cancelled && ps3ExtractedForYml.size > 0) {
    await emulators
      .mergeWriteGamesYml(ps3Exe, ps3ExtractedForYml)
      .catch((err) => logger.error("Could not merge-write games.yml", err));
  }

  return {
    fileCount: totalFileCount,
    sizeBytes: totalSizeBytes,
    matched,
    unmatched,
    unmatchedFiles,
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
        unmatchedFiles: result.unmatchedFiles,
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
