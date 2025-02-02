import { registerEvent } from "../register-event";
import { findAchievementFiles } from "@main/services/achievements/find-achivement-files";
import fs from "fs";
import { achievementsLogger, HydraApi, WindowManager } from "@main/services";
import { getUnlockedAchievements } from "../user/get-unlocked-achievements";
import {
  gameAchievementsSublevel,
  gamesSublevel,
  levelKeys,
} from "@main/level";
import type { GameShop } from "@types";

const resetGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  try {
    const game = await gamesSublevel.get(levelKeys.game(shop, objectId));

    if (!game) return;

    const achievementFiles = findAchievementFiles(game);

    if (achievementFiles.length) {
      for (const achievementFile of achievementFiles) {
        achievementsLogger.log(`deleting ${achievementFile.filePath}`);
        await fs.promises.rm(achievementFile.filePath);
      }
    }

    const levelKey = levelKeys.game(game.shop, game.objectId);

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
