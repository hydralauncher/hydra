import type {
  AchievementSouvenirSyncStatus,
  PendingAchievementSouvenir,
} from "@types";

export const getAchievementSouvenirSyncStatusForOwner = (
  souvenirs: PendingAchievementSouvenir[],
  ownerId: string
) =>
  souvenirs.reduce<AchievementSouvenirSyncStatus>(
    (status, souvenir) => {
      if (souvenir.ownerId !== ownerId) return status;
      if (souvenir.status === "terminal") status.failedCount += 1;
      else status.pendingCount += 1;
      if (
        souvenir.lastErrorCode &&
        !status.errorCodes.includes(souvenir.lastErrorCode)
      ) {
        status.errorCodes.push(souvenir.lastErrorCode);
      }
      return status;
    },
    { pendingCount: 0, failedCount: 0, errorCodes: [] }
  );

export const prepareAchievementSouvenirForRetry = (
  souvenir: PendingAchievementSouvenir
): PendingAchievementSouvenir => {
  if (souvenir.status === "terminal") return souvenir;

  return {
    ...souvenir,
    lastAttemptAt: undefined,
  };
};
