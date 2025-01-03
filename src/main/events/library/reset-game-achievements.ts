import { gameAchievementRepository, gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { findAchievementFiles } from "@main/services/achievements/find-achivement-files";
import fs from "fs";
import { achievementsLogger, HydraApi, WindowManager } from "@main/services";
import { getUnlockedAchievements } from "../user/get-unlocked-achievements";

const resetGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  try {
    const game = await gameRepository.findOne({ where: { id: gameId } });

    if (!game) return;

    const achievementFiles = findAchievementFiles(game);

    if (achievementFiles.length) {
      for (const achievementFile of achievementFiles) {
        achievementsLogger.log(`deleting ${achievementFile.filePath}`);
        await fs.promises.rm(achievementFile.filePath);
      }
    }

    await gameAchievementRepository.update(
      { objectId: game.objectID },
      {
        unlockedAchievements: null,
      }
    );

    await HydraApi.delete(`/profile/games/achievements/${game.remoteId}`).then(
      () =>
        achievementsLogger.log(
          `Deleted achievements from ${game.remoteId} - ${game.objectID} - ${game.title}`
        )
    );

    const gameAchievements = await getUnlockedAchievements(
      game.objectID,
      game.shop,
      true
    );

    WindowManager.mainWindow?.webContents.send(
      `on-update-achievements-${game.objectID}-${game.shop}`,
      gameAchievements
    );
  } catch (error) {
    achievementsLogger.error(error);
    throw error;
  }
};

registerEvent("resetGameAchievements", resetGameAchievements);
