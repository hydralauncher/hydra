import type {
  AchievementSouvenirSyncItem,
  Game,
  PendingAchievementSouvenir,
  SteamAchievement,
} from "@types";

export const buildAchievementSouvenirSyncItem = (
  souvenir: PendingAchievementSouvenir,
  game: Game | null,
  catalogue: SteamAchievement[]
): AchievementSouvenirSyncItem => {
  const metadata = new Map(
    catalogue.map((entry) => [entry.name.toUpperCase(), entry])
  );
  const achievements = souvenir.achievements.map(({ name }) => {
    const entry = metadata.get(name.toUpperCase());
    return {
      name,
      displayName: entry?.displayName || name,
      iconUrl: entry?.icon || null,
    };
  });

  return {
    clientId: souvenir.clientId,
    status: souvenir.status === "terminal" ? "failed" : "pending",
    screenshotPath: souvenir.screenshotPath,
    gameTitle: game?.title ?? null,
    gameIconUrl: game?.customIconUrl ?? game?.iconUrl ?? null,
    achievementNames: achievements.map((entry) => entry.displayName),
    achievements,
    capturedAt: souvenir.capturedAt,
    lastErrorCode: souvenir.lastErrorCode,
  };
};
