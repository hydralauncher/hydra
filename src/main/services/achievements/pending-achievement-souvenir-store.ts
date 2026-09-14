import { pendingAchievementSouvenirsSublevel } from "@main/level";

export const PendingAchievementSouvenirStore = {
  get: async (gameKey: string) =>
    (await pendingAchievementSouvenirsSublevel.get(gameKey)) ?? {},

  set: async (gameKey: string, achievementName: string, imageKey: string) => {
    const pending =
      (await pendingAchievementSouvenirsSublevel.get(gameKey)) ?? {};

    await pendingAchievementSouvenirsSublevel.put(gameKey, {
      ...pending,
      [achievementName.toUpperCase()]: imageKey,
    });
  },

  clearSynced: async (
    gameKey: string,
    achievements: Array<{ name: string; imageKey?: string | null }>
  ) => {
    const pending =
      (await pendingAchievementSouvenirsSublevel.get(gameKey)) ?? {};

    for (const achievement of achievements) {
      const name = achievement.name.toUpperCase();

      if (achievement.imageKey && pending[name] === achievement.imageKey) {
        delete pending[name];
      }
    }

    if (Object.keys(pending).length) {
      await pendingAchievementSouvenirsSublevel.put(gameKey, pending);
    } else {
      await pendingAchievementSouvenirsSublevel.del(gameKey);
    }
  },
};
