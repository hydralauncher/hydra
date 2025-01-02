import { gameAchievementRepository, gameRepository } from "@main/repository";
import { registerEvent } from "../register-event";
import { findAchievementFiles } from "@main/services/achievements/find-achivement-files";
import fs from "fs";
import { WindowManager } from "@main/services";
import { getUnlockedAchievements } from "../user/get-unlocked-achievements";
import { HydraApi } from "@main/services/hydra-api";

const resetGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  gameId: number
) => {
  const game = await gameRepository.findOne({ where: { id: gameId } });

  if (!game) return;

  const achievementFiles = findAchievementFiles(game);

  if (achievementFiles.length) {
    try {
      await Promise.all(
        achievementFiles.map(async (achievementFile) => {
          await fs.promises.rm(achievementFile.filePath, { recursive: true });
        })
      );
    } catch (error) {
      console.error(error);
    }
  }

  await gameAchievementRepository.update(
    { objectId: game.objectID },
    {
      unlockedAchievements: null,
    }
  );

  try {
    await HydraApi.delete(`/profile/games/${game.remoteId}/achievements`);
  } catch (error) {
    console.error(error);
  }

  const gameAchievements = await getUnlockedAchievements(
    game.objectID,
    game.shop,
    true
  );

  WindowManager.mainWindow?.webContents.send(
    `on-update-achievements-${game.objectID}-${game.shop}`,
    gameAchievements
  );
};

registerEvent("resetGameAchievements", resetGameAchievements);
