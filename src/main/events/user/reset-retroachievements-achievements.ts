import type { UserAchievement } from "@types";
import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";
import { AchievementMemoryStore } from "@main/services/achievements/achievement-memory-store";
import {
  cancelPendingSouvenirsForShop,
  deleteLocalSouvenirAssetsForShop,
} from "@main/services/achievements/grouped-souvenir-worker";

const LAUNCHBOX_KEY_PREFIX = "launchbox:";

const resetRetroAchievementsAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  pendingSouvenirsOnly = false
) => {
  await cancelPendingSouvenirsForShop("launchbox");
  if (pendingSouvenirsOnly) return;
  await deleteLocalSouvenirAssetsForShop("launchbox");

  for (const [key, gameAchievement] of AchievementMemoryStore.all()) {
    if (!key.startsWith(LAUNCHBOX_KEY_PREFIX)) continue;

    const objectId = key.slice(LAUNCHBOX_KEY_PREFIX.length);
    AchievementMemoryStore.set("launchbox", objectId, {
      ...gameAchievement,
      unlockedAchievements: [],
    });

    const lockedAchievements: UserAchievement[] = (
      gameAchievement.achievements ?? []
    ).map((achievement) => ({
      ...achievement,
      unlocked: false,
      unlockTime: null,
    }));

    WindowManager.mainWindow?.webContents.send(
      `on-update-achievements-${objectId}-launchbox`,
      lockedAchievements
    );
  }
};

registerEvent(
  "resetRetroAchievementsAchievements",
  resetRetroAchievementsAchievements
);
