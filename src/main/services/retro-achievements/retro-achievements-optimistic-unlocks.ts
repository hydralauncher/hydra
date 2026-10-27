import type { SteamAchievement } from "@types";

import type { DetectedRetroAchievementUnlock } from "./retro-achievements-unlock-confirmer";

export const retroAchievementKey = (name: string) => name.toUpperCase();

export const countSessionUnlocks = (
  catalogue: SteamAchievement[],
  unlockedNames: Iterable<string>,
  notifiedKeys: ReadonlySet<string>
) => {
  const unlockedKeys = new Set(
    Array.from(unlockedNames, (name) => retroAchievementKey(name))
  );

  return catalogue.filter((achievement) => {
    const key = retroAchievementKey(achievement.name);
    return unlockedKeys.has(key) || notifiedKeys.has(key);
  }).length;
};

export const selectOptimisticUnlocks = (
  detected: DetectedRetroAchievementUnlock[],
  catalogue: SteamAchievement[],
  unlockedNames: Iterable<string>,
  notifiedKeys: ReadonlySet<string>
) => {
  const unlockedKeys = new Set(
    Array.from(unlockedNames, (name) => retroAchievementKey(name))
  );
  const catalogueByKey = new Map(
    catalogue.map((achievement) => [
      retroAchievementKey(achievement.name),
      achievement,
    ])
  );
  const selected = new Map<string, SteamAchievement>();

  for (const { id } of detected) {
    const key = retroAchievementKey(id);
    const achievement = catalogueByKey.get(key);
    if (!achievement || unlockedKeys.has(key) || notifiedKeys.has(key)) {
      continue;
    }
    selected.set(key, achievement);
  }

  return Array.from(selected.values());
};
