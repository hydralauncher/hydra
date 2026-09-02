import type { UserAchievement } from "@types";

export interface RetroArchSouvenirAchievement {
  id: string;
  title: string;
  unlockTime?: number;
}

const achievementKey = (name: string) => name.toLowerCase();

interface RetroArchSouvenirCandidate {
  achievement: Pick<RetroArchSouvenirAchievement, "id">;
}

export const partitionHandledRetroArchSouvenirs = <
  T extends RetroArchSouvenirCandidate,
>(
  souvenirs: T[],
  handledAchievementIds: ReadonlySet<string>
) => {
  const handled: T[] = [];
  const unhandled: T[] = [];

  for (const souvenir of souvenirs) {
    const target = handledAchievementIds.has(
      achievementKey(souvenir.achievement.id)
    )
      ? handled
      : unhandled;
    target.push(souvenir);
  }

  return { handled, unhandled };
};

export const groupRetroArchSouvenirAchievements = (
  detectedAchievements: RetroArchSouvenirAchievement[],
  syncedAchievements: UserAchievement[]
) => {
  const syncedByName = new Map(
    syncedAchievements
      .filter((achievement) => {
        return achievement.unlocked && achievement.unlockTime !== null;
      })
      .map((achievement) => [achievementKey(achievement.name), achievement])
  );

  const detectedWithUnlockTime = detectedAchievements.map((achievement) => {
    const synced = syncedByName.get(achievementKey(achievement.id));

    return {
      ...achievement,
      unlockTime: synced?.unlockTime ?? achievement.unlockTime,
    };
  });
  const detectedUnlockTimes = new Set(
    detectedWithUnlockTime.flatMap((achievement) => {
      return achievement.unlockTime === undefined
        ? []
        : [achievement.unlockTime];
    })
  );

  if (detectedUnlockTimes.size === 0) return detectedAchievements;

  const detectedNames = new Set(
    detectedAchievements.map((achievement) => achievementKey(achievement.id))
  );
  const matchingAchievements = syncedAchievements
    .filter((achievement) => {
      return (
        achievement.unlocked &&
        achievement.unlockTime !== null &&
        detectedUnlockTimes.has(achievement.unlockTime) &&
        !detectedNames.has(achievementKey(achievement.name))
      );
    })
    .map((achievement) => ({
      id: achievement.name,
      title: achievement.displayName,
      unlockTime: achievement.unlockTime!,
    }));

  return [...detectedWithUnlockTime, ...matchingAchievements];
};
