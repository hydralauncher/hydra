import { registerEvent } from "../register-event";
import { findAchievementFiles } from "@main/services/achievements/find-achievement-files";
import fs from "fs";
import { achievementsLogger, HydraApi, WindowManager } from "@main/services";
import { getUnlockedAchievements } from "../user/get-unlocked-achievements";
import {
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type { GameShop } from "@types";
import { getEmulatorConfig } from "@main/services/emulators/emulators-repository";
import {
  clearRpcs3TrophyProgress,
  isLaunchboxRpcs3Game,
  readRpcs3TrophyState,
} from "@main/services/emulators/rpcs3-trophies";
import { logger } from "@main/services";
import { emulatorSessions } from "@main/services/emulators/emulator-session-tracker";

const resetGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  try {
    const levelKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(levelKey);

    if (!game) return;

    logger.log("resetGameAchievements called", {
      shop,
      objectId,
      title: game.title,
    });

    logger.log("resetGameAchievements checking RPCS3 eligibility", {
      shop: game.shop,
      objectId: game.objectId,
      title: game.title,
    });

    if (await isLaunchboxRpcs3Game(game.shop, game.objectId)) {
      const gameKey = levelKeys.game(game.shop, game.objectId);
      const runningSession = emulatorSessions.get(gameKey);
      if (runningSession && runningSession.child.exitCode === null) {
        logger.log("resetGameAchievements blocked because RPCS3 is running", {
          gameKey,
          title: game.title,
        });

        throw new Error(
          "Close RPCS3 before resetting achievements for this game."
        );
      }

      logger.log("resetGameAchievements entering RPCS3 reset path", {
        shop: game.shop,
        objectId: game.objectId,
        title: game.title,
      });

      const emulatorConfig = await getEmulatorConfig("ps3");
      logger.log("resetGameAchievements loaded PS3 emulator config", {
        executablePath: emulatorConfig.executablePath,
      });

      logger.log("resetGameAchievements reading RPCS3 trophy state", {
        executablePath: emulatorConfig.executablePath,
        title: game.title,
      });

      const trophyState = await readRpcs3TrophyState(
        emulatorConfig.executablePath,
        game.title
      );

      logger.log("resetGameAchievements clearing RPCS3 trophy progress", {
        executablePath: emulatorConfig.executablePath,
        title: game.title,
      });

      const deleted = await clearRpcs3TrophyProgress(
        emulatorConfig.executablePath,
        game.title
      );

      if (deleted) {
        logger.log("resetGameAchievements cleared RPCS3 trophy DAT", {
          title: game.title,
          hasTrophyState: Boolean(trophyState),
        });

        if (trophyState) {
          await gameAchievementsSublevel.put(levelKey, {
            achievements: trophyState.achievements,
            unlockedAchievements: [],
            updatedAt: Date.now(),
            language: "rpcs3",
            catalogueValidator: trophyState.trophyPaths.trophyDir,
          });
        }

        const gameAchievements = await getUnlockedAchievements(
          game.objectId,
          game.shop,
          true
        );

        WindowManager.mainWindow?.webContents.send(
          `on-update-achievements-${game.objectId}-${game.shop}`,
          gameAchievements
        );

        return;
      }

      logger.log(
        "resetGameAchievements RPCS3 DAT clear failed or was skipped",
        {
          title: game.title,
        }
      );
    }

    logger.log("resetGameAchievements using non-RPCS3 reset path", {
      shop: game.shop,
      objectId: game.objectId,
      title: game.title,
    });

    const achievementFiles = findAchievementFiles(game);

    if (achievementFiles.length) {
      for (const achievementFile of achievementFiles) {
        achievementsLogger.log(`deleting ${achievementFile.filePath}`);
        await fs.promises.rm(achievementFile.filePath);
      }
    }

    await gameAchievementsSublevel
      .get(levelKey)
      .then(async (gameAchievements) => {
        if (gameAchievements) {
          await gameAchievementsSublevel.put(levelKey, {
            ...gameAchievements,
            unlockedAchievements: [],
          });
        }
      });

    await HydraApi.delete(`/profile/games/achievements/${game.remoteId}`).then(
      () =>
        achievementsLogger.log(
          `Deleted achievements from ${game.remoteId} - ${game.objectId} - ${game.title}`
        )
    );

    const gameAchievements = await getUnlockedAchievements(
      game.objectId,
      game.shop,
      true
    );

    WindowManager.mainWindow?.webContents.send(
      `on-update-achievements-${game.objectId}-${game.shop}`,
      gameAchievements
    );
  } catch (error) {
    achievementsLogger.error(error);
    throw error;
  }
};

registerEvent("resetGameAchievements", resetGameAchievements);
