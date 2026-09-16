import type {
  SteamSourceAchievement,
  SteamSourceLibraryGame,
  SteamSnapshotAchievement,
  SteamSnapshotPayload,
} from "@types";

export const STEAM_SNAPSHOT_MAX_ACHIEVEMENTS_PER_GAME = 2_000;

export const buildSteamSnapshotAchievements = (
  sourceAchievements: SteamSourceAchievement[]
): SteamSnapshotAchievement[] | undefined => {
  const achievements = sourceAchievements.flatMap((achievement) => {
    if (!achievement.unlocked || !achievement.unlockTime) {
      return [];
    }

    return [
      {
        name: achievement.name,
        unlockTime: achievement.unlockTime,
      },
    ];
  });

  if (achievements.length > STEAM_SNAPSHOT_MAX_ACHIEVEMENTS_PER_GAME) {
    return undefined;
  }

  return achievements;
};

export const buildSteamSnapshot = (
  games: SteamSourceLibraryGame[],
  achievementsByAppId: Map<string, SteamSourceAchievement[] | undefined>
): SteamSnapshotPayload => ({
  games: games.map((game) => {
    const steamAppId = String(game.steamAppId);
    const sourceAchievements = achievementsByAppId.get(steamAppId);
    const achievements = sourceAchievements
      ? buildSteamSnapshotAchievements(sourceAchievements)
      : undefined;

    return {
      steamAppId,
      name: game.name,
      playTimeInSeconds: game.playTimeInSeconds,
      lastPlayedAt: game.lastPlayedAt,
      ...(achievements !== undefined ? { achievements } : {}),
    };
  }),
});
