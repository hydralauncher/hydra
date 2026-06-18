import type { GameShop, UserAchievement, UserPreferences } from "@types";
import { registerEvent } from "../register-event";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";
import {
  db,
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { HydraApi } from "@main/services";
import { achievementsLogger } from "@main/services/logger";
import { mergeRetroachievements } from "@main/services/achievements/merge-retroachievements";
import { resolveRetroachievementsGameId } from "@main/services/achievements/retroachievements-fetcher";

export const getUnlockedAchievements = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean
): Promise<UserAchievement[]> => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
  );

  const retroachievementsApiKey =
    userPreferences?.retroachievementsApiKey ?? "";
  const retroachievementsUsername =
    userPreferences?.retroachievementsUsername ?? "";

  if (shop === "launchbox") {
    const game = await gamesSublevel
      .get(levelKeys.game(shop, objectId))
      .catch(() => null);
    let title = game?.title ?? "";
    let platform = game?.platform ?? null;

    if (!title || !platform) {
      try {
        type LaunchboxShopDetails = {
          objectId: string;
          platform?: string | null;
          data?: {
            title?: string;
          };
        };

        const [basic, details] = await Promise.all([
          HydraApi.get<{ title?: string } | null>(
            `/games/${shop}/${objectId}`,
            null,
            {
              needsAuth: false,
            }
          ).catch(() => null),
          HydraApi.post<LaunchboxShopDetails[]>(
            `/games/shop-details`,
            { shop, objectIds: [objectId] },
            { needsAuth: false }
          ).catch(() => []),
        ]);

        if (basic?.title) title = basic.title;

        if (Array.isArray(details) && details.length > 0) {
          const entry = details.find((item) => item.objectId === objectId);
          if (entry?.platform) platform = entry.platform;
          if (!title && entry?.data?.title) title = entry.data.title;
        }
      } catch (error) {
        achievementsLogger.warn(
          `Failed to refresh LaunchBox metadata for ${objectId}`,
          error
        );
      }
    }

    const isPlaystationClassic =
      typeof platform === "string" &&
      /(playstation 2|ps2|playstation 1|ps1|psx)/i.test(platform);

    if (
      isPlaystationClassic &&
      retroachievementsApiKey &&
      retroachievementsUsername
    ) {
      const retroAchievementsGameId = await resolveRetroachievementsGameId({
        title,
        platform,
        apiKey: retroachievementsApiKey,
        username: retroachievementsUsername,
        cachedGameId: game?.retroachievementsGameId ?? null,
        cachedGameTitle: game?.retroachievementsGameTitle ?? null,
        cachedGamePlatform: game?.retroachievementsGamePlatform ?? null,
      });

      if (retroAchievementsGameId) {
        if (game && game.retroachievementsGameId !== retroAchievementsGameId) {
          await gamesSublevel.put(levelKeys.game(shop, objectId), {
            ...game,
            retroachievementsGameId: retroAchievementsGameId,
            retroachievementsGameTitle: title,
            retroachievementsGamePlatform: platform,
          });
        }

        const retroAchievements = await mergeRetroachievements(
          retroAchievementsGameId,
          retroachievementsApiKey,
          retroachievementsUsername
        );
        if (retroAchievements.length > 0) {
          return retroAchievements;
        }
      }
    }
  }

  const cachedAchievements = await gameAchievementsSublevel.get(
    levelKeys.game(shop, objectId)
  );

  const showHiddenAchievementsDescription =
    userPreferences?.showHiddenAchievementsDescription || false;

  const achievementsData = await getGameAchievementData(
    objectId,
    shop,
    useCachedData
  );

  const unlockedAchievements = cachedAchievements?.unlockedAchievements ?? [];

  return achievementsData
    .map((achievementData) => {
      const unlockedAchievementData = unlockedAchievements.find(
        (localAchievement) => {
          return (
            localAchievement.name.toUpperCase() ==
            achievementData.name.toUpperCase()
          );
        }
      );

      const icongray = achievementData.icongray.endsWith("/")
        ? achievementData.icon
        : achievementData.icongray;

      if (unlockedAchievementData) {
        return {
          ...achievementData,
          unlocked: true,
          unlockTime: unlockedAchievementData.unlockTime,
        };
      }

      return {
        ...achievementData,
        unlocked: false,
        unlockTime: null,
        icongray: icongray,
        description:
          !achievementData.hidden || showHiddenAchievementsDescription
            ? achievementData.description
            : undefined,
      };
    })
    .sort((a, b) => {
      if (a.unlocked && !b.unlocked) return -1;
      if (!a.unlocked && b.unlocked) return 1;
      if (a.unlocked && b.unlocked) {
        return b.unlockTime! - a.unlockTime!;
      }
      return Number(a.hidden) - Number(b.hidden);
    });
};

const getUnlockedAchievementsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  const game = await gamesSublevel
    .get(levelKeys.game(shop, objectId))
    .catch(() => null);
  const isPlaystationClassic =
    shop === "launchbox" &&
    typeof game?.platform === "string" &&
    /(playstation 2|ps2|playstation 1|ps1|psx)/i.test(game.platform);

  if (!isPlaystationClassic) {
    await AchievementWatcherManager.firstSyncWithRemoteIfNeeded(shop, objectId);
  }

  return getUnlockedAchievements(objectId, shop, false);
};

registerEvent("getUnlockedAchievements", getUnlockedAchievementsEvent);
