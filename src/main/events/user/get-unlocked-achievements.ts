import type { Game, GameShop, UserAchievement, UserPreferences } from "@types";
import { registerEvent } from "../register-event";
import { getGameAchievementData } from "@main/services/achievements/get-game-achievement-data";
import {
  db,
  gameAchievementsSublevel,
  gamesShopCacheSublevel,
  levelKeys,
} from "@main/level";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";
import { getEmulatorConfig } from "@main/services/emulators/emulators-repository";
import { logger } from "@main/services";
import {
  buildRpcs3UserAchievements,
  isLaunchboxRpcs3Game,
  readRpcs3TrophyState,
  saveRpcs3TrophyState,
} from "@main/services/emulators/rpcs3-trophies";

export const getUnlockedAchievements = async (
  objectId: string,
  shop: GameShop,
  useCachedData: boolean
): Promise<UserAchievement[]> => {
  const cachedAchievements = await gameAchievementsSublevel.get(
    levelKeys.game(shop, objectId)
  );

  const game = await db.get<string, Game | null>(
    levelKeys.game(shop, objectId),
    {
      valueEncoding: "json",
    }
  );

  const language = await db
    .get<string, string>(levelKeys.language, {
      valueEncoding: "utf8",
    })
    .then((value) => value || "en")
    .catch(() => "en");

  const cachedShopDetails =
    shop === "launchbox"
      ? await gamesShopCacheSublevel
          .get(levelKeys.gameShopCacheItem(shop, objectId, language))
          .catch(() => null)
      : null;

  const resolvedTitle = game?.title ?? cachedShopDetails?.name ?? "";

  logger.log("getUnlockedAchievements called", {
    shop,
    objectId,
    useCachedData,
    hasGame: Boolean(game),
    title: game?.title,
    resolvedTitle,
  });

  if (!game?.title && resolvedTitle) {
    logger.log("getUnlockedAchievements resolved title from shop cache", {
      shop,
      objectId,
      language,
      resolvedTitle,
    });
  }

  logger.log("getUnlockedAchievements checking RPCS3 eligibility", {
    shop,
    objectId,
    title: resolvedTitle,
  });

  if (await isLaunchboxRpcs3Game(shop, objectId)) {
    logger.log("getUnlockedAchievements entering RPCS3 path", {
      shop,
      objectId,
      title: resolvedTitle,
    });

    const emulatorConfig = await getEmulatorConfig("ps3");
    logger.log("getUnlockedAchievements loaded PS3 emulator config", {
      executablePath: emulatorConfig.executablePath,
      title: resolvedTitle,
    });

    logger.log("getUnlockedAchievements reading RPCS3 trophy state", {
      executablePath: emulatorConfig.executablePath,
      title: resolvedTitle,
    });

    const trophyState = await readRpcs3TrophyState(
      emulatorConfig.executablePath,
      resolvedTitle
    );

    logger.log("getUnlockedAchievements RPCS3 trophy state result", {
      title: resolvedTitle,
      hasTrophyState: Boolean(trophyState),
    });

    if (trophyState) {
      const userPreferences = await db.get<string, UserPreferences | null>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

      await saveRpcs3TrophyState(levelKeys.game(shop, objectId), trophyState);

      return buildRpcs3UserAchievements(
        trophyState,
        userPreferences?.showHiddenAchievementsDescription || false
      );
    }

    if (cachedAchievements?.language === "rpcs3") {
      logger.log("getUnlockedAchievements using cached RPCS3 achievements", {
        title: resolvedTitle,
      });

      const userPreferences = await db.get<string, UserPreferences | null>(
        levelKeys.userPreferences,
        {
          valueEncoding: "json",
        }
      );

      return buildRpcs3UserAchievements(
        {
          achievements: cachedAchievements.achievements ?? [],
          unlockedAchievements: cachedAchievements.unlockedAchievements ?? [],
          trophyPaths: {
            trophyRootDir: "",
            trophyDir: "",
            sfmFilePath: "",
            datFilePath: "",
          },
        },
        userPreferences?.showHiddenAchievementsDescription || false
      );
    }

    logger.log(
      "getUnlockedAchievements RPCS3 path had no trophy state and no cache",
      {
        title: resolvedTitle,
      }
    );
  }

  logger.log("getUnlockedAchievements using standard achievement path", {
    shop,
    objectId,
    title: resolvedTitle,
  });

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    {
      valueEncoding: "json",
    }
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

export const syncAndGetUnlockedAchievements = async (
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  await AchievementWatcherManager.firstSyncWithRemoteIfNeeded(shop, objectId);
  return getUnlockedAchievements(objectId, shop, false);
};

const getUnlockedAchievementsEvent = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop
): Promise<UserAchievement[]> => {
  return syncAndGetUnlockedAchievements(objectId, shop);
};

registerEvent("getUnlockedAchievements", getUnlockedAchievementsEvent);
