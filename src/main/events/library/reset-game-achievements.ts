import { setTimeout } from "node:timers/promises";
import { isAxiosError } from "axios";
import {
  achievementSyncCoordinator,
  AchievementSyncCancelledError,
  ACHIEVEMENT_RESET_RETRY_BUDGET_MS,
  ACHIEVEMENT_SYNC_REQUEST_TIMEOUT_MS,
} from "@main/services/achievements/achievement-sync-coordinator";
import type { HydraApiAuthContext } from "@main/services/hydra-auth-context";
import {
  achievementSyncWorker,
  getAchievementSyncRetryDelay,
  isRetryableAchievementSyncStatus,
} from "@main/services/achievements/achievement-sync-worker";
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
import { updateGameRecord } from "@main/services/game-record-updater";

const deleteRemoteAchievements = async (
  levelKey: string,
  remoteId: string | null,
  context: HydraApiAuthContext,
  current: () => boolean,
  deadline = Date.now() + ACHIEVEMENT_RESET_RETRY_BUDGET_MS,
  attempt = 0
): Promise<void> => {
  try {
    await achievementSyncCoordinator.runResetRequest(
      levelKey,
      () =>
        HydraApi.delete(`/profile/games/achievements/${remoteId}`, {
          authContext: context,
          timeout: ACHIEVEMENT_SYNC_REQUEST_TIMEOUT_MS,
        }),
      current
    );
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    const remaining = deadline - Date.now();
    if (
      remaining <= 0 ||
      status === undefined ||
      !isRetryableAchievementSyncStatus(status)
    )
      throw error;
    achievementsLogger.warn(
      "Achievement reset request failed, retrying",
      levelKey,
      status
    );
    await setTimeout(
      Math.min(getAchievementSyncRetryDelay(error, attempt), remaining)
    );
    await deleteRemoteAchievements(
      levelKey,
      remoteId,
      context,
      current,
      deadline,
      attempt + 1
    );
  }
};

const resetGameAchievementsNow = async (
  shop: GameShop,
  objectId: string,
  context: HydraApiAuthContext
) => {
  const current = () => HydraApi.isAuthContextCurrent(context);
  const assertCurrent = () => {
    if (!current()) throw new AchievementSyncCancelledError();
  };
  try {
    assertCurrent();
    const levelKey = levelKeys.game(shop, objectId);
    const game = await gamesSublevel.get(levelKey);

    assertCurrent();
    if (!game) return;

    await achievementSyncWorker.cancelGame(levelKey);
    await cancelPendingSouvenirsForGame(levelKey);
    assertCurrent();

    const achievementFiles = await collectGameAchievementFiles(game, {
      includeSteamCache: false,
      awaitGameDirectoryLocations: true,
    });

    for (const achievementFile of achievementFiles) {
      assertCurrent();
      achievementsLogger.log(`deleting ${achievementFile.filePath}`);

      await fs.promises.rm(achievementFile.filePath, {
        force: true,
        recursive: true,
      });
    }

    assertCurrent();
    AchievementWatcherManager.forgetAchievementFiles(
      levelKey,
      achievementFiles.map((achievementFile) => achievementFile.filePath)
    );

    if (game.reportedUnlockedAchievementCount !== undefined) {
      await updateGameRecord(levelKey, {
        reportedUnlockedAchievementCount: undefined,
      });
    }

    await deleteRemoteAchievements(levelKey, game.remoteId, context, current);
    assertCurrent();
    const gameAchievements = AchievementMemoryStore.get(shop, objectId);
    if (gameAchievements) {
      AchievementMemoryStore.set(shop, objectId, {
        ...gameAchievements,
        unlockedAchievements: [],
      });
    }

    await deleteLocalSouvenirAssetsForGame(levelKey);
    assertCurrent();
    AchievementSouvenirStore.invalidate(shop, objectId);
    achievementsLogger.log(
      `Deleted Hydra achievements from ${game.remoteId} - ${game.objectId} - ${game.title}`
    );

    const updatedAchievements = await getUnlockedAchievements(
      game.objectId,
      game.shop,
      false,
      current
    );

    assertCurrent();
    WindowManager.mainWindow?.webContents.send(
      `on-update-achievements-${game.objectId}-${game.shop}`,
      updatedAchievements
    );
  } catch (error) {
    achievementsLogger.error(error);
    throw error;
  }
};

const resetGameAchievements = (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string
) => {
  const context = HydraApi.getAuthContext();
  if (!context) return Promise.reject(new AchievementSyncCancelledError());
  return achievementSyncCoordinator.resetGame(
    levelKeys.game(shop, objectId),
    () => resetGameAchievementsNow(shop, objectId, context),
    () => HydraApi.isAuthContextCurrent(context)
  );
};
registerEvent("resetGameAchievements", resetGameAchievements);
