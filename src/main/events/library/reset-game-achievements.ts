import { registerEvent } from "../register-event";
import { collectGameAchievementFiles } from "@main/services/achievements/collect-game-achievement-files";
import fs from "fs";
import { achievementsLogger, HydraApi, WindowManager } from "@main/services";
import { getUnlockedAchievements } from "../user/get-unlocked-achievements";
import { gamesSublevel, levelKeys } from "@main/level";
import type { GameShop } from "@types";
import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import { AchievementSouvenirStore } from "@main/services/achievements/achievement-souvenir-store";
import {
  cancelPendingSouvenirsForGame,
  deleteLocalSouvenirAssetsForGame,
} from "@main/services/achievements/grouped-souvenir-worker";
import { AchievementWatcherManager } from "@main/services/achievements/achievement-watcher-manager";

const resetGameAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  try {
    const levelKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(levelKey);

    if (!game) return;

    await cancelPendingSouvenirsForGame(levelKey);

    const achievementFiles = await collectGameAchievementFiles(game, {
      includeSteamCache: false,
      awaitGameDirectoryLocations: true,
    });

    for (const achievementFile of achievementFiles) {
      achievementsLogger.log(`deleting ${achievementFile.filePath}`);

      await fs.promises.rm(achievementFile.filePath, {
        force: true,
        recursive: true,
      });
    }

    AchievementWatcherManager.forgetAchievementFiles(
      levelKey,
      achievementFiles.map((achievementFile) => achievementFile.filePath)
    );

    const gameAchievements = AchievementMemoryStore.get(shop, objectId);
    if (gameAchievements) {
      AchievementMemoryStore.set(shop, objectId, {
        ...gameAchievements,
        unlockedAchievements: [],
      });
    }

    if (game.reportedUnlockedAchievementCount !== undefined) {
      await gamesSublevel.put(levelKey, {
        ...game,
        reportedUnlockedAchievementCount: undefined,
      });
    }

    await HydraApi.delete(`/profile/games/achievements/${game.remoteId}`).then(
      async () => {
        await deleteLocalSouvenirAssetsForGame(levelKey);
        AchievementSouvenirStore.invalidate(shop, objectId);
        achievementsLogger.log(
          `Deleted achievements from ${game.remoteId} - ${game.objectId} - ${game.title}`
        );
      }
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
