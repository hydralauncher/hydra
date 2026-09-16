import type {
  SteamSourceAchievement,
  SteamSourceLibraryGame,
  SteamGameSyncPayload,
  SteamSnapshotAchievement,
  SteamSnapshotChunkPayload,
  SteamSnapshotGame,
  SteamSnapshotPayload,
} from "@types";

export const STEAM_SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE = 2_000;

export const buildSteamSnapshotAchievements = (
  sourceAchievements: SteamSourceAchievement[]
): SteamSnapshotAchievement[] =>
  sourceAchievements.flatMap((achievement) => {
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

export const chunkSteamSnapshot = (
  snapshot: SteamSnapshotPayload
): SteamSnapshotChunkPayload[] => {
  const gameChunks: SteamSnapshotGame[][] = [];
  let currentGames: SteamSnapshotGame[] = [];
  let currentAchievementCount = 0;

  const flush = () => {
    gameChunks.push(currentGames);
    currentGames = [];
    currentAchievementCount = 0;
  };

  for (const game of snapshot.games) {
    if (game.achievements === undefined || game.achievements.length === 0) {
      currentGames.push(game);
      continue;
    }

    let achievementIndex = 0;
    while (achievementIndex < game.achievements.length) {
      if (currentAchievementCount === STEAM_SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE) {
        flush();
      }

      const remainingCapacity =
        STEAM_SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE - currentAchievementCount;
      const achievements = game.achievements.slice(
        achievementIndex,
        achievementIndex + remainingCapacity
      );
      currentGames.push({ ...game, achievements });
      currentAchievementCount += achievements.length;
      achievementIndex += achievements.length;
    }
  }

  if (currentGames.length > 0 || gameChunks.length === 0) flush();

  const totalChunks = gameChunks.length;
  return gameChunks.map((games) => ({ totalChunks, games }));
};

export const chunkSteamGameSyncPayload = (
  payload: SteamGameSyncPayload
): SteamGameSyncPayload[] => {
  if (
    payload.achievements === undefined ||
    payload.achievements.length <= STEAM_SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE
  ) {
    return [payload];
  }

  const chunks: SteamGameSyncPayload[] = [];
  for (
    let index = 0;
    index < payload.achievements.length;
    index += STEAM_SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE
  ) {
    chunks.push({
      ...payload,
      achievements: payload.achievements.slice(
        index,
        index + STEAM_SNAPSHOT_ACHIEVEMENT_CHUNK_SIZE
      ),
    });
  }
  return chunks;
};

export const uploadSteamSnapshotChunks = async (
  chunks: SteamSnapshotChunkPayload[],
  stage: (
    chunk: SteamSnapshotChunkPayload,
    chunkIndex: number
  ) => Promise<void>,
  commit: () => Promise<void>
) => {
  for (const [chunkIndex, chunk] of chunks.entries()) {
    await stage(chunk, chunkIndex);
  }
  await commit();
};
