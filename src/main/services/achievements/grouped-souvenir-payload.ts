import type {
  PendingAchievementSouvenir,
  PendingSouvenirAchievement,
} from "@types";

export const MAX_ACHIEVEMENTS_PER_SOUVENIR = 50;

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
