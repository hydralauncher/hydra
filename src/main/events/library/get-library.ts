import { getContextualEpicGame } from "@main/services/epic/import-visibility";
import { epicLibraryArtworkQueue } from "@main/services/epic-library-artwork";
import { updateGameRecord } from "@main/services/game-record-updater";
import { logger } from "@main/services/logger";
import path from "node:path";
import fs from "node:fs";

import type { Download, Game, LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
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

// An Epic copy without its own definitions presents its linked Steam catalogue.
const resolveLibraryAchievementCount = async (game: Game) => {
  const achievementCount = resolveAchievementCount(
    game.shop,
    game.objectId,
    game.achievementCount
  );
  if (
    game.shop !== "epic" ||
    achievementCount !== 0 ||
    game.catalogueGame?.shop !== "steam"
  ) {
    return achievementCount;
  }

  const steamGame = await gamesSublevel
    .get(levelKeys.game("steam", game.catalogueGame.objectId))
    .catch(() => undefined);
  return resolveAchievementCount(
    "steam",
    game.catalogueGame.objectId,
    steamGame?.achievementCount
  );
};

// Clears the installer size when the installer was deleted outside Hydra.
const resolveInstallerSize = (
  key: string,
  game: Game,
  download: Download | undefined
) => {
  if (!game.installerSizeInBytes || !download?.folderName) {
    return game.installerSizeInBytes;
  }
  if (fs.existsSync(path.join(download.downloadPath, download.folderName))) {
    return game.installerSizeInBytes;
  }

  updateGameRecord(key, { installerSizeInBytes: null }).catch((error) =>
    logger.error(`Failed to clear missing installer size for ${key}`, error)
  );
  return null;
};

const getLibrary = async (
  collection: "visible" | "hidden" | "all" = "visible"
): Promise<LibraryGame[]> => {
  const authContext = HydraApi.getAuthContext();
  const entries = (await gamesSublevel.iterator().all())
    .filter(([_key, game]) => belongsToLibraryCollection(game, collection))
    .map(
      ([key, storedGame]) =>
        [key, getContextualEpicGame(storedGame, authContext)] as const
    )
    .filter(([_key, game]) => !game.isDeleted);
  const keys = entries.map(([key]) => key);
  const catalogueKeys = entries.map(([key, game]) =>
    game.catalogueGame
      ? levelKeys.game(game.catalogueGame.shop, game.catalogueGame.objectId)
      : key
  );
  // Batched reads: one round trip per sublevel instead of three per game.
  const [downloads, shopAssets, artworkSelections] = await Promise.all([
    downloadsSublevel.getMany(keys),
    gamesShopAssetsSublevel.getMany(catalogueKeys),
    gamesArtworkSelectionSublevel.getMany(keys),
  ]);

  return Promise.all(
    entries.map(async ([key, game], index) => {
      const download = downloads[index];
      const gameAssets = shopAssets[index];
      const artworkSelection = artworkSelections[index];
      const composedAssets = composeAssetsWithArtwork(
        game.shop === "epic" &&
          game.catalogueGame?.shop !== "steam" &&
          gameAssets &&
          !gameAssets.epicArtworkUpdatedAtByType?.icon
          ? { ...gameAssets, iconUrl: null }
          : (gameAssets ?? null),
        artworkSelection
      );
      const unlockedAchievementCount = resolveUnlockedAchievementCount(
        game.shop,
        game.objectId,
        game.unlockedAchievementCount
      );
      const achievementCount = await resolveLibraryAchievementCount(game);
      const installerSizeInBytes = resolveInstallerSize(key, game, download);

      if (
        game.shop === "launchbox" &&
        (!game.platform || game.platform === null)
      ) {
        const cachedPlatform = await lookupCachedPlatform(key);
        if (cachedPlatform) {
          game.platform = cachedPlatform;
          updateGameRecord(key, { platform: game.platform }).catch(() => {});
        }
      }

      // Verify installed folder still exists, clear if deleted externally
      let installedSizeInBytes = game.installedSizeInBytes;
      if (installedSizeInBytes && game.executablePath) {
        const executableDir = path.dirname(game.executablePath);

        if (!fs.existsSync(executableDir)) {
          installedSizeInBytes = null;
          updateGameRecord(key, {
            installerSizeInBytes,
            installedSizeInBytes: null,
          }).catch((error) =>
            logger.error(
              `Failed to clear missing installed size for ${key}`,
              error
            )
          );
        }
      }

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
    })
  ).then((library) => {
    if (HydraApi.isLoggedIn()) epicLibraryArtworkQueue.schedule(library);
    return library;
  });
};

registerEvent(
  "getLibrary",
  (_event, includeConcealed = false) =>
    getLibrary(includeConcealed ? "all" : "visible"),
  { jsonSafeResult: true }
);
registerEvent(
  "getHiddenLibrary",
  () => (HydraApi.isLoggedIn() ? getLibrary("hidden") : Promise.resolve([])),
  { jsonSafeResult: true }
);
