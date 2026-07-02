import type { UserAchievement } from "@types";
import { registerEvent } from "../register-event";
import { gameAchievementsSublevel } from "@main/level";
import { WindowManager } from "@main/services";

const LAUNCHBOX_KEY_PREFIX = "launchbox:";

const resetRetroAchievementsAchievements = async () => {
  const entries = await gameAchievementsSublevel.iterator().all();

  for (const [key, gameAchievement] of entries) {
    if (!key.startsWith(LAUNCHBOX_KEY_PREFIX)) continue;

    await gameAchievementsSublevel.put(key, {
      ...gameAchievement,
      unlockedAchievements: [],
    });

    const objectId = key.slice(LAUNCHBOX_KEY_PREFIX.length);
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
