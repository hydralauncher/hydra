import { getContextualEpicGame } from "@main/services/epic/import-visibility";
import { updateGameRecord } from "@main/services/game-record-updater";
import { logger } from "@main/services/logger";
import path from "node:path";
import fs from "node:fs";

import type { LibraryGame } from "@types";
import { registerEvent } from "../register-event";
import {
  downloadsSublevel,
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
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

const getLibrary = async (
  collection: "visible" | "hidden" | "all" = "visible"
): Promise<LibraryGame[]> => {
  return gamesSublevel
    .iterator()
    .all()
    .then((results) => {
      return Promise.all(
        results
          .filter(([_key, game]) =>
            belongsToLibraryCollection(game, collection)
          )
          .map(async ([key, storedGame]) => {
            const game = getContextualEpicGame(
              storedGame,
              HydraApi.getAuthContext()
            );
            if (game.isDeleted) return null;
            const download = await downloadsSublevel.get(key);
            const gameAssets = await gamesShopAssetsSublevel.get(key);
            const artworkSelection =
              await gamesArtworkSelectionSublevel.get(key);
            const composedAssets = composeAssetsWithArtwork(
              game.shop === "epic" &&
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

            // Verify installer still exists, clear if deleted externally
            let installerSizeInBytes = game.installerSizeInBytes;
            if (installerSizeInBytes && download?.folderName) {
              const installerPath = path.join(
                download.downloadPath,
                download.folderName
              );

              if (!fs.existsSync(installerPath)) {
                installerSizeInBytes = null;
                updateGameRecord(key, { installerSizeInBytes: null }).catch(
                  (error) =>
                    logger.error(
                      `Failed to clear missing installer size for ${key}`,
                      error
                    )
                );
              }
            }

            if (
              game.shop === "launchbox" &&
              (!game.platform || game.platform === null)
            ) {
              const cachedPlatform = await lookupCachedPlatform(key);
              if (cachedPlatform) {
                game.platform = cachedPlatform;
                updateGameRecord(key, { platform: game.platform }).catch(
                  () => {}
                );
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
              unlockedAchievementCount,
              achievementCount: resolveAchievementCount(
                game.shop,
                game.objectId,
                game.achievementCount
              ),
              // Spread composed assets last to ensure all image URLs are properly set
              ...composedAssets,
              ...(game.shop === "epic" && {
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
      ).then((games) =>
        games.filter((game): game is NonNullable<typeof game> => game !== null)
      );
    });
};

registerEvent("getLibrary", (_event, includeConcealed = false) =>
  getLibrary(includeConcealed ? "all" : "visible")
);
registerEvent("getHiddenLibrary", () =>
  HydraApi.isLoggedIn() ? getLibrary("hidden") : Promise.resolve([])
);
