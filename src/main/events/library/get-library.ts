import path from "node:path";
import fs from "node:fs";

import type { LibraryGame, UserPreferences } from "@types";
import { registerEvent } from "../register-event";
import {
  db,
  downloadsSublevel,
  gamesArtworkSelectionSublevel,
  gamesShopAssetsSublevel,
  gamesShopCacheSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { composeAssetsWithArtwork, getSteamContentWarning } from "@shared";
import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import { getSteamAppDetails, logger } from "@main/services";
import { persistContentWarning } from "./persist-content-warning";

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

// Steam content_descriptors only get fetched (and cached) when the user opens
// Game Details for a specific game. This surfaces that cached data for games
// the library already has on disk, without making a fresh Steam API call.
export const lookupCachedContentDescriptorIds = async (
  gameKey: string
): Promise<number[] | null> => {
  const prefix = `${gameKey}:`;
  try {
    const entries = await gamesShopCacheSublevel.iterator().all();
    for (const [key, value] of entries) {
      if (
        typeof key === "string" &&
        key.startsWith(prefix) &&
        value?.content_descriptors?.ids
      ) {
        return value.content_descriptors.ids;
      }
    }
  } catch {
    return null;
  }
  return null;
};

// Bounds how much work a single getLibrary() call can push onto Steam's
// unauthenticated, undocumented-rate-limit storefront API. Any games left
// over are picked up by a later call - the backlog drains gradually instead
// of bursting requests for a whole large library at once.
const MAX_STEAM_CONTENT_CLASSIFICATIONS_PER_LOAD = 20;
const MAX_CONCURRENT_STEAM_CONTENT_CLASSIFICATIONS = 2;

// Tracks objectIds currently being classified so overlapping getLibrary()
// calls (e.g. rapid manual refreshes) don't queue duplicate Steam requests
// for the same game.
const pendingSteamContentClassifications = new Set<string>();

const classifyPendingSteamContentWarnings = async (
  objectIds: string[]
): Promise<void> => {
  const queue = objectIds.filter(
    (objectId) => !pendingSteamContentClassifications.has(objectId)
  );
  queue.forEach((objectId) => pendingSteamContentClassifications.add(objectId));

  try {
    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length) {
        const objectId = queue[cursor];
        cursor += 1;

        try {
          const result = await getSteamAppDetails(objectId, "en");
          if (result?.content_descriptors?.ids) {
            await persistContentWarning(
              "steam",
              objectId,
              result.content_descriptors.ids
            );
          }
        } catch (err) {
          logger.error("Could not classify steam game content warning", err);
        }
      }
    };

    await Promise.all(
      Array.from(
        {
          length: Math.min(
            MAX_CONCURRENT_STEAM_CONTENT_CLASSIFICATIONS,
            queue.length
          ),
        },
        worker
      )
    );
  } finally {
    queue.forEach((objectId) =>
      pendingSteamContentClassifications.delete(objectId)
    );
  }
};

const getLibrary = async (): Promise<LibraryGame[]> => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );
  const pendingSteamObjectIds: string[] = [];

  const libraryGames = await gamesSublevel
    .iterator()
    .all()
    .then((results) => {
      return Promise.all(
        results
          .filter(([_key, game]) => game.isDeleted === false)
          .map(async ([key, game]) => {
            const download = await downloadsSublevel.get(key);
            const gameAssets = await gamesShopAssetsSublevel.get(key);
            const artworkSelection =
              await gamesArtworkSelectionSublevel.get(key);
            const composedAssets = composeAssetsWithArtwork(
              gameAssets ?? null,
              artworkSelection
            );
            const achievements = AchievementMemoryStore.get(
              game.shop,
              game.objectId
            );

            const validAchievementNames = new Set(
              achievements?.achievements?.map((a) =>
                (a.name ?? "").toUpperCase()
              ) || []
            );

            const unlockedAchievementCount =
              achievements?.unlockedAchievements?.filter(
                (unlocked) =>
                  validAchievementNames.has(
                    (unlocked.name ?? "").toUpperCase()
                  ) && unlocked.unlockTime > 0
              ).length ??
              game.unlockedAchievementCount ??
              0;

            // Verify installer still exists, clear if deleted externally
            let installerSizeInBytes = game.installerSizeInBytes;
            if (installerSizeInBytes && download?.folderName) {
              const installerPath = path.join(
                download.downloadPath,
                download.folderName
              );

              if (!fs.existsSync(installerPath)) {
                installerSizeInBytes = null;
                gamesSublevel.put(key, { ...game, installerSizeInBytes: null });
              }
            }

            if (
              game.shop === "launchbox" &&
              (!game.platform || game.platform === null)
            ) {
              const cachedPlatform = await lookupCachedPlatform(key);
              if (cachedPlatform) {
                game.platform = cachedPlatform;
                gamesSublevel.put(key, game).catch(() => {});
              }
            }

            if (game.shop === "steam" && !game.contentWarning) {
              const cachedDescriptorIds =
                await lookupCachedContentDescriptorIds(key);
              if (cachedDescriptorIds) {
                game.contentWarning =
                  getSteamContentWarning(cachedDescriptorIds);
                gamesSublevel.put(key, game).catch(() => {});
              } else if (userPreferences?.hideAdultContent) {
                // No cached Steam details either - queue a live classification
                // so this game stops silently bypassing the library filter.
                pendingSteamObjectIds.push(game.objectId);
              }
            }

            // Verify installed folder still exists, clear if deleted externally
            let installedSizeInBytes = game.installedSizeInBytes;
            if (installedSizeInBytes && game.executablePath) {
              const executableDir = path.dirname(game.executablePath);

              if (!fs.existsSync(executableDir)) {
                installedSizeInBytes = null;
                gamesSublevel.put(key, {
                  ...game,
                  installerSizeInBytes,
                  installedSizeInBytes: null,
                });
              }
            }

            return {
              id: key,
              ...game,
              installerSizeInBytes,
              installedSizeInBytes,
              download: download ?? null,
              unlockedAchievementCount,
              achievementCount: game.achievementCount ?? 0,
              // Spread composed assets last to ensure all image URLs are properly set
              ...composedAssets,
              title: composedAssets?.title || game.title,
              platform: game.platform ?? null,
              // Preserve custom image URLs from game if they exist
              customIconUrl: game.customIconUrl,
              customLogoImageUrl: game.customLogoImageUrl,
              customHeroImageUrl: game.customHeroImageUrl,
              customCoverImageUrl: game.customCoverImageUrl,
            };
          })
      );
    });

  if (pendingSteamObjectIds.length > 0) {
    classifyPendingSteamContentWarnings(
      pendingSteamObjectIds.slice(0, MAX_STEAM_CONTENT_CLASSIFICATIONS_PER_LOAD)
    ).catch((err) => {
      logger.error("Could not classify pending steam content warnings", err);
    });
  }

  return libraryGames;
};

registerEvent("getLibrary", getLibrary);
