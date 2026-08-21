import type {
  PendingAchievementSouvenir,
  PendingSouvenirAchievement,
} from "@types";

export const MAX_ACHIEVEMENTS_PER_SOUVENIR = 50;

export const chunkGroupedSouvenirAchievements = (
  achievements: PendingSouvenirAchievement[]
) => {
  const chunks: PendingSouvenirAchievement[][] = [];

  for (
    let index = 0;
    index < achievements.length;
    index += MAX_ACHIEVEMENTS_PER_SOUVENIR
  ) {
    chunks.push(
      achievements.slice(index, index + MAX_ACHIEVEMENTS_PER_SOUVENIR)
    );
  }

  return chunks;
};

export const getGroupedSouvenirAchievementNames = (
  achievements: PendingSouvenirAchievement[]
) =>
  achievements
    .slice(0, MAX_ACHIEVEMENTS_PER_SOUVENIR)
    .map((achievement) => achievement.name);

type GroupedSouvenirPayloadSource = Pick<
  PendingAchievementSouvenir,
  "capturedAt" | "clientId" | "imageKey" | "remoteGameId"
>;

export const buildGroupedSouvenirSyncPayload = (
  pending: GroupedSouvenirPayloadSource,
  achievements: PendingSouvenirAchievement[],
  includeSouvenir: boolean
) => ({
  id: pending.remoteGameId,
  achievements,
  ...(includeSouvenir && {
    souvenirs: [
      {
        clientId: pending.clientId,
        imageKey: pending.imageKey!,
        capturedAt: pending.capturedAt,
        achievementNames: getGroupedSouvenirAchievementNames(achievements),
      },
    ],
  }),
});
