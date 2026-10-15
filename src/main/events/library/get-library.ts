import { getContextualEpicGame } from "@main/services/epic/import-visibility";
import { epicLibraryArtworkQueue } from "@main/services/epic-library-artwork";
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
            const catalogueKey = game.catalogueGame
              ? levelKeys.game(
                  game.catalogueGame.shop,
                  game.catalogueGame.objectId
                )
              : key;
            const gameAssets = await gamesShopAssetsSublevel.get(catalogueKey);
            const artworkSelection =
              await gamesArtworkSelectionSublevel.get(key);
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
            let achievementCount = resolveAchievementCount(
              game.shop,
              game.objectId,
              game.achievementCount
            );
            // An Epic copy without its own definitions presents its linked Steam catalogue.
            if (
              game.shop === "epic" &&
              achievementCount === 0 &&
              game.catalogueGame?.shop === "steam"
            ) {
              const steamGame = await gamesSublevel
                .get(levelKeys.game("steam", game.catalogueGame.objectId))
                .catch(() => undefined);
              achievementCount = resolveAchievementCount(
                "steam",
                game.catalogueGame.objectId,
                steamGame?.achievementCount
              );
            }

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
      ).then((games) => {
        const library = games.filter(
          (game): game is NonNullable<typeof game> => game !== null
        );
        if (HydraApi.isLoggedIn()) epicLibraryArtworkQueue.schedule(library);
        return library;
      });
    });
};

registerEvent("getLibrary", (_event, includeConcealed = false) =>
  getLibrary(includeConcealed ? "all" : "visible")
);
registerEvent("getHiddenLibrary", () =>
  HydraApi.isLoggedIn() ? getLibrary("hidden") : Promise.resolve([])
);
