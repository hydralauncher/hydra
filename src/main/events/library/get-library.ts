import { getContextualEpicGame } from "@main/services/epic/import-visibility";
import { epicLibraryArtworkQueue } from "@main/services/epic-library-artwork";
import { updateGameRecord } from "@main/services/game-record-updater";
import { logger } from "@main/services/logger";
import path from "node:path";
import fs from "node:fs";

import type {
  AchievementProgress,
  Download,
  Game,
  GameArtworkSelection,
  LibraryGame,
  ShopAssets,
} from "@types";
import { registerEvent } from "../register-event";
import {
  achievementProgressSublevel,
  downloadsSublevel,
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { composeAssetsWithArtwork } from "@shared";
import { HydraApi } from "@main/services/hydra-api";
import { belongsToLibraryCollection } from "@main/services/library-sync/game-visibility";
import {
  resolveAchievementCount,
  resolveUnlockedAchievementCount,
} from "@main/services/achievements/achievement-memory-store";

export const lookupCachedPlatform = async (
  gameKey: string
): Promise<string | null> => {
  const prefix = `${gameKey}:`;
  try {
    const entries = await gamesShopCacheSublevel.iterator().all();
    for (const [key, value] of entries) {
      if (
        typeof key === "string" &&
        key.startsWith(prefix) &&
        value?.platform
      ) {
        return value.platform;
      }
    }
  } catch {
    return null;
  }
  return null;
};

const toEntryMap = <V>(entries: Promise<[string, V][]>) =>
  entries.then((items) => new Map(items)).catch(() => new Map<string, V>());

const loadCachedPlatforms = async () => {
  const platforms = new Map<string, string>();
  const entries = await gamesShopCacheSublevel
    .iterator()
    .all()
    .catch(() => []);

  for (const [key, value] of entries) {
    if (typeof key !== "string" || !value?.platform) continue;
    const gameKey = key.slice(0, key.lastIndexOf(":"));
    if (!platforms.has(gameKey)) platforms.set(gameKey, value.platform);
  }

  return platforms;
};

interface LibrarySources {
  achievementProgress: (
    key: string
  ) => Promise<AchievementProgress | undefined>;
  download: (key: string) => Promise<Download | undefined>;
  assets: (key: string) => Promise<ShopAssets | undefined>;
  artworkSelection: (
    key: string
  ) => Promise<GameArtworkSelection | null | undefined>;
  cachedPlatform: (key: string) => Promise<string | null | undefined>;
}

const resolveAchievementCounts = async (
  game: Game,
  achievementProgress: AchievementProgress | null
) => {
  const counts = {
    unlockedAchievementCount: resolveUnlockedAchievementCount(
      game.shop,
      game.objectId,
      game.unlockedAchievementCount
    ),
    achievementCount: resolveAchievementCount(
      game.shop,
      game.objectId,
      game.achievementCount
    ),
  };
  // An Epic copy without its own definitions presents its linked Steam catalogue.
  if (
    game.shop !== "epic" ||
    counts.achievementCount !== 0 ||
    game.catalogueGame?.shop !== "steam"
  ) {
    return counts;
  }

  if (achievementProgress) {
    return {
      achievementCount: achievementProgress.achievementCount,
      unlockedAchievementCount: achievementProgress.unlockedAchievementCount,
    };
  }

  const steamGame = await gamesSublevel
    .get(levelKeys.game("steam", game.catalogueGame.objectId))
    .catch(() => undefined);
  return {
    ...counts,
    achievementCount: resolveAchievementCount(
      "steam",
      game.catalogueGame.objectId,
      steamGame?.achievementCount
    ),
  };
};

// Verify installer still exists, clear if deleted externally
const resolveInstallerSize = (
  key: string,
  game: Game,
  download: Download | undefined
) => {
  if (!game.installerSizeInBytes || !download?.folderName) {
    return game.installerSizeInBytes;
  }

  const installerPath = path.join(download.downloadPath, download.folderName);
  if (fs.existsSync(installerPath)) return game.installerSizeInBytes;

  updateGameRecord(key, { installerSizeInBytes: null }).catch((error) =>
    logger.error(`Failed to clear missing installer size for ${key}`, error)
  );
  return null;
};

// Verify installed folder still exists, clear if deleted externally
const resolveInstalledSize = (
  key: string,
  game: Game,
  installerSizeInBytes: number | null | undefined
) => {
  if (!game.installedSizeInBytes || !game.executablePath) {
    return game.installedSizeInBytes;
  }

  if (fs.existsSync(path.dirname(game.executablePath))) {
    return game.installedSizeInBytes;
  }

  updateGameRecord(key, {
    installerSizeInBytes,
    installedSizeInBytes: null,
  }).catch((error) =>
    logger.error(`Failed to clear missing installed size for ${key}`, error)
  );
  return null;
};

const restoreCachedPlatform = async (
  key: string,
  game: Game,
  sources: LibrarySources
) => {
  if (game.shop !== "launchbox" || game.platform) return;

  const cachedPlatform = await sources.cachedPlatform(key);
  if (!cachedPlatform) return;

  game.platform = cachedPlatform;
  updateGameRecord(key, { platform: game.platform }).catch(() => {});
};

const buildLibraryGame = async (
  key: string,
  storedGame: Game,
  sources: LibrarySources
): Promise<LibraryGame | null> => {
  const game = getContextualEpicGame(storedGame, HydraApi.getAuthContext());
  if (game.isDeleted) return null;
  const download = await sources.download(key);
  const catalogueKey = game.catalogueGame
    ? levelKeys.game(game.catalogueGame.shop, game.catalogueGame.objectId)
    : key;
  const gameAssets = await sources.assets(catalogueKey);
  const artworkSelection = (await sources.artworkSelection(key)) ?? null;
  const composedAssets = composeAssetsWithArtwork(
    game.shop === "epic" &&
      game.catalogueGame?.shop !== "steam" &&
      gameAssets &&
      !gameAssets.epicArtworkUpdatedAtByType?.icon
      ? { ...gameAssets, iconUrl: null }
      : (gameAssets ?? null),
    artworkSelection
  );
  const achievementProgress = (await sources.achievementProgress(key)) ?? null;
  const { achievementCount, unlockedAchievementCount } =
    await resolveAchievementCounts(game, achievementProgress);
  const installerSizeInBytes = resolveInstallerSize(key, game, download);
  await restoreCachedPlatform(key, game, sources);
  const installedSizeInBytes = resolveInstalledSize(
    key,
    game,
    installerSizeInBytes
  );

  return {
    id: key,
    ...game,
    installerSizeInBytes,
    installedSizeInBytes,
    download: download ?? null,
    // Spread composed assets last to ensure all image URLs are properly set
    ...composedAssets,
    shop: game.shop,
    objectId: game.objectId,
    unlockedAchievementCount,
    achievementCount,
    achievementProgress,
    ...(game.shop === "epic" &&
      game.catalogueGame?.shop !== "steam" && {
        iconUrl: composedAssets?.iconUrl ?? null,
      }),
    title: composedAssets?.title || game.title,
    platform: game.platform ?? null,
    // Preserve custom image URLs from game if they exist
    customIconUrl: game.customIconUrl,
    customLogoImageUrl: game.customLogoImageUrl,
    customHeroImageUrl: game.customHeroImageUrl,
    customCoverImageUrl: game.customCoverImageUrl,
  };
};

const loadAllLibrarySources = async (): Promise<LibrarySources> => {
  const [
    achievementProgressByKey,
    downloadsByKey,
    assetsByKey,
    artworkSelectionByKey,
  ] = await Promise.all([
    toEntryMap(achievementProgressSublevel.iterator().all()),
    toEntryMap(downloadsSublevel.iterator().all()),
    toEntryMap(gamesShopAssetsSublevel.iterator().all()),
    toEntryMap(gamesArtworkSelectionSublevel.iterator().all()),
  ]);
  let cachedPlatforms: Promise<Map<string, string>> | null = null;

  return {
    achievementProgress: (key) =>
      Promise.resolve(achievementProgressByKey.get(key)),
    download: (key) => Promise.resolve(downloadsByKey.get(key)),
    assets: (key) => Promise.resolve(assetsByKey.get(key)),
    artworkSelection: (key) => Promise.resolve(artworkSelectionByKey.get(key)),
    cachedPlatform: async (key) => {
      cachedPlatforms ??= loadCachedPlatforms();
      return (await cachedPlatforms).get(key);
    },
  };
};

const pointLibrarySources: LibrarySources = {
  achievementProgress: (key) =>
    achievementProgressSublevel.get(key).catch(() => undefined),
  download: (key) => downloadsSublevel.get(key).catch(() => undefined),
  assets: (key) => gamesShopAssetsSublevel.get(key).catch(() => undefined),
  artworkSelection: (key) =>
    gamesArtworkSelectionSublevel.get(key).catch(() => undefined),
  cachedPlatform: (key) => lookupCachedPlatform(key),
};

const isLibraryGame = (game: LibraryGame | null): game is LibraryGame =>
  game !== null;

const getLibrary = async (
  collection: "visible" | "hidden" | "all" = "visible"
): Promise<LibraryGame[]> => {
  const sources = await loadAllLibrarySources();
  const results = await gamesSublevel.iterator().all();
  const library = (
    await Promise.all(
      results
        .filter(([_key, game]) => belongsToLibraryCollection(game, collection))
        .map(([key, storedGame]) => buildLibraryGame(key, storedGame, sources))
    )
  ).filter(isLibraryGame);

  if (HydraApi.isLoggedIn()) epicLibraryArtworkQueue.schedule(library);
  return library;
};

const getLibraryGames = async (
  keys: string[],
  collection: "visible" | "all"
): Promise<LibraryGame[]> => {
  const games = await Promise.all(
    [...new Set(keys)].map(async (key) => {
      const storedGame = await gamesSublevel.get(key).catch(() => undefined);
      if (!storedGame || !belongsToLibraryCollection(storedGame, collection)) {
        return null;
      }
      return buildLibraryGame(key, storedGame, pointLibrarySources);
    })
  );

  return games.filter(isLibraryGame);
};

registerEvent("getLibrary", (_event, includeConcealed = false) =>
  getLibrary(includeConcealed ? "all" : "visible")
);
registerEvent(
  "getLibraryGames",
  (_event, keys: string[], includeConcealed = false) =>
    getLibraryGames(keys, includeConcealed ? "all" : "visible")
);
registerEvent("getLibrarySerialized", (_event, includeConcealed = false) =>
  getLibrary(includeConcealed ? "all" : "visible").then((library) =>
    JSON.stringify(library)
  )
);
registerEvent("getHiddenLibrary", () =>
  HydraApi.isLoggedIn() ? getLibrary("hidden") : Promise.resolve([])
);
