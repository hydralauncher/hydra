import type { GameShop, SteamAchievement, UnlockedAchievement } from "@types";

type AchievementMemoryEntry = {
  achievements: SteamAchievement[];
  unlockedAchievements: UnlockedAchievement[];
  language?: string;
  catalogueValidator?: string;
};

const entries = new Map<string, AchievementMemoryEntry>();

const gameKey = (shop: GameShop, objectId: string) => `${shop}:${objectId}`;

export const AchievementMemoryStore = {
  get(shop: GameShop, objectId: string) {
    return entries.get(gameKey(shop, objectId));
  },

  set(
    shop: GameShop,
    objectId: string,
    achievementEntry: AchievementMemoryEntry
  ) {
    entries.set(gameKey(shop, objectId), achievementEntry);
  },

  delete(shop: GameShop, objectId: string) {
    entries.delete(gameKey(shop, objectId));
  },

  all() {
    return entries.entries();
  },

  clear() {
    entries.clear();
  },
};

export const resolveAchievementCount = (
  shop: GameShop,
  objectId: string,
  persistedCount?: number | null
) => {
  const stored = AchievementMemoryStore.get(shop, objectId);
  return Math.max(stored?.achievements.length ?? 0, persistedCount ?? 0);
};

export const resolveUnlockedAchievementCount = (
  shop: GameShop,
  objectId: string,
  remoteCount?: number | null
) => {
  const achievements = AchievementMemoryStore.get(shop, objectId);
  const validNames = new Set(
    achievements?.achievements.map((achievement) =>
      (achievement.name ?? "").toUpperCase()
    ) ?? []
  );
  const hasCatalogue = validNames.size > 0;
  const localCount =
    achievements?.unlockedAchievements.filter((unlocked) => {
      if (unlocked.unlockTime <= 0) return false;
      if (!hasCatalogue) return true;
      return validNames.has((unlocked.name ?? "").toUpperCase());
    }).length ?? 0;

  return Math.max(localCount, remoteCount ?? 0);
};

export const mergePersistedAchievementTotals = (
  shop: GameShop,
  objectId: string,
  local: {
    achievementCount?: number | null;
    unlockedAchievementCount?: number | null;
  },
  remote: {
    achievementCount?: number | null;
    unlockedAchievementCount?: number | null;
  }
) => ({
  achievementCount: resolveAchievementCount(
    shop,
    objectId,
    Math.max(local.achievementCount ?? 0, remote.achievementCount ?? 0)
  ),
  unlockedAchievementCount: resolveUnlockedAchievementCount(
    shop,
    objectId,
    Math.max(
      local.unlockedAchievementCount ?? 0,
      remote.unlockedAchievementCount ?? 0
    )
  ),
});
