import type {
  SteamSourceAchievement,
  SteamSourceLibraryGame,
  SteamSnapshotPayload,
} from "@types";

export const buildSteamSnapshot = (
  games: SteamSourceLibraryGame[],
  achievementsByAppId: Map<string, SteamSourceAchievement[] | undefined>
): SteamSnapshotPayload => ({
  games: games.map((game) => {
    const steamAppId = String(game.steamAppId);
    const sourceAchievements = achievementsByAppId.get(steamAppId) ?? [];

    return {
      steamAppId,
      name: game.name,
      playTimeInSeconds: game.playTimeInSeconds,
      lastPlayedAt: game.lastPlayedAt,
      achievements: sourceAchievements.flatMap((achievement) => {
        if (!achievement.unlocked || !achievement.unlockTime) {
          return [];
        }

        return [
          {
            name: achievement.name,
            unlockTime: achievement.unlockTime,
          },
        ];
      }),
    };
  }),
});
