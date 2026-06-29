import type {
  GameShop,
  SteamAchievement,
  UnlockedAchievement,
  UserAchievement,
  UserPreferences,
} from "@types";
import { registerEvent } from "../register-event";
import { db, gameAchievementsSublevel, levelKeys } from "@main/level";
import { RetroAchievementsClient } from "@main/services/retro-achievements/retro-achievements-client";

const RA_BADGE_URL = "https://media.retroachievements.org/Badge";

const toMillis = (date?: string) => {
  if (!date) return null;
  const time = new Date(`${date.replace(" ", "T")}Z`).getTime();
  return Number.isNaN(time) ? null : time;
};

const getRetroAchievementsAchievements = async (
  _event: Electron.IpcMainInvokeEvent,
  objectId: string,
  shop: GameShop,
  raGameId: number
): Promise<UserAchievement[] | null> => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const webApiKey = userPreferences?.retroAchievementsWebApiKey;
  const username = userPreferences?.retroAchievementsUsername;

  if (!webApiKey || !username) return null;

  const data = await RetroAchievementsClient.getGameInfoAndUserProgress({
    username,
    webApiKey,
    raGameId,
  });

  const remoteAchievements = Object.values(data.Achievements ?? {});

  const cachedAchievements = await gameAchievementsSublevel.get(
    levelKeys.game(shop, objectId)
  );
  const cachedUnlocked = cachedAchievements?.unlockedAchievements ?? [];

  const unlockedByName = new Map<string, UnlockedAchievement>();
  for (const unlocked of cachedUnlocked) {
    unlockedByName.set(unlocked.name.toUpperCase(), unlocked);
  }

  const hardcoreByName = new Map<string, number>();

  for (const achievement of remoteAchievements) {
    const name = String(achievement.ID);
    const unlockTime = toMillis(
      achievement.DateEarned ?? achievement.DateEarnedHardcore
    );
    const hardcoreUnlockTime = toMillis(achievement.DateEarnedHardcore);

    if (hardcoreUnlockTime != null) {
      hardcoreByName.set(name.toUpperCase(), hardcoreUnlockTime);
    }

    if (unlockTime != null && !unlockedByName.has(name.toUpperCase())) {
      unlockedByName.set(name.toUpperCase(), { name, unlockTime });
    }
  }

  const catalogue: SteamAchievement[] = remoteAchievements.map(
    (achievement) => ({
      name: String(achievement.ID),
      displayName: achievement.Title,
      description: achievement.Description,
      icon: `${RA_BADGE_URL}/${achievement.BadgeName}.png`,
      icongray: `${RA_BADGE_URL}/${achievement.BadgeName}_lock.png`,
      hidden: false,
      points: achievement.Points,
    })
  );

  await gameAchievementsSublevel.put(levelKeys.game(shop, objectId), {
    achievements: catalogue,
    unlockedAchievements: Array.from(unlockedByName.values()),
    updatedAt: Date.now(),
    language: cachedAchievements?.language,
  });

  return catalogue
    .map((achievementData) => {
      const unlocked = unlockedByName.get(achievementData.name.toUpperCase());

      return {
        ...achievementData,
        unlocked: Boolean(unlocked),
        unlockTime: unlocked?.unlockTime ?? null,
        hardcoreUnlockTime:
          hardcoreByName.get(achievementData.name.toUpperCase()) ?? null,
        source: "retroachievements" as const,
      };
    })
    .sort((a, b) => {
      if (a.unlocked && !b.unlocked) return -1;
      if (!a.unlocked && b.unlocked) return 1;
      if (a.unlocked && b.unlocked) {
        return b.unlockTime! - a.unlockTime!;
      }
      return Number(a.hidden) - Number(b.hidden);
    });
};

registerEvent(
  "getRetroAchievementsAchievements",
  getRetroAchievementsAchievements
);
