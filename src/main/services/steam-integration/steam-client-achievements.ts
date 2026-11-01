// binarykvparser turns KeyValues objects with keys 0..n into arrays, so `stats` and `bits` can be either.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export type SteamClientAchievementBlock = {
  achievement_id?: number | null;
  unlock_time?: number[] | null;
};

export type SteamClientPlayerAchievement = {
  apiname: string;
  achieved: number;
  unlocktime: number;
};

/**
 * `schemaRoot` is the parsed binary KeyValues schema Steam sends with the stats.
 * Each stat with `bits` is an achievement group: `unlock_time[bit]` is the Unix
 * unlock time, and 0 means locked.
 */
export const mapSteamClientAchievements = (
  schemaRoot: unknown,
  blocks: SteamClientAchievementBlock[]
): SteamClientPlayerAchievement[] => {
  const app = isRecord(schemaRoot) ? Object.values(schemaRoot)[0] : null;
  const stats = isRecord(app) ? app.stats : null;
  if (!isRecord(stats)) return [];

  const unlockTimesByStatId = new Map(
    blocks.map((block) => [
      Number(block.achievement_id),
      block.unlock_time ?? [],
    ])
  );

  return Object.entries(stats).flatMap(([statId, stat]) => {
    const bits = isRecord(stat) ? stat.bits : null;
    if (!isRecord(bits)) return [];

    return Object.entries(bits).flatMap(([bit, definition]) => {
      const apiname = isRecord(definition) ? definition.name : null;
      if (typeof apiname !== "string" || !apiname) return [];

      const unlocktime = Number(
        unlockTimesByStatId.get(Number(statId))?.[Number(bit)] ?? 0
      );

      return [{ apiname, achieved: unlocktime > 0 ? 1 : 0, unlocktime }];
    });
  });
};

export type SteamAchievementSourceCounts = {
  client: number;
  noAchievements: number;
  scrape: number;
};

export const steamClientSuccessPercentage = ({
  client,
  scrape,
}: SteamAchievementSourceCounts) => {
  const total = client + scrape;
  return total === 0 ? 100 : Math.round((client / total) * 1000) / 10;
};
