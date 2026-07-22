import { registerEvent } from "../register-event";
import { findAchievementFiles } from "@main/services/achievements/find-achievement-files";
import fs from "fs";
import { achievementsLogger, HydraApi, WindowManager } from "@main/services";
import { getUnlockedAchievements } from "../user/get-unlocked-achievements";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";

const resetGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  try {
    const levelKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(levelKey);

    if (!game) return;

    const achievementFiles = findAchievementFiles(game);

    if (achievementFiles.length) {
      for (const achievementFile of achievementFiles) {
        achievementsLogger.log(`deleting ${achievementFile.filePath}`);
        await fs.promises.rm(achievementFile.filePath);
      }
    }

    const gameAchievements = AchievementMemoryStore.get(shop, objectId);
    if (gameAchievements) {
      AchievementMemoryStore.set(shop, objectId, {
        ...gameAchievements,
        unlockedAchievements: [],
      });
    }

    await HydraApi.delete(`/profile/games/achievements/${game.remoteId}`).then(
      () =>
        achievementsLogger.log(
          `Deleted achievements from ${game.remoteId} - ${game.objectId} - ${game.title}`
        )
    );

    const updatedAchievements = await getUnlockedAchievements(
      game.objectId,
      game.shop,
      true
    );

    WindowManager.mainWindow?.webContents.send(
      `on-update-achievements-${game.objectId}-${game.shop}`,
      updatedAchievements
    );
  } catch (error) {
    achievementsLogger.error(error);
    throw error;
  }
};

registerEvent("resetGameAchievements", resetGameAchievements);
