import type { UnlockedAchievement } from "@types";

export const mergeUnlockedAchievementLists = (
  remote: UnlockedAchievement[],
  local: UnlockedAchievement[]
): UnlockedAchievement[] => {
  const remoteNames = new Set(
    remote.map((achievement) => achievement.name.toUpperCase())
  );

  const localOnly = local.filter(
    (achievement) => !remoteNames.has(achievement.name.toUpperCase())
  );

  return localOnly.length ? [...remote, ...localOnly] : remote;
};
