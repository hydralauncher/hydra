export type RankTier = "gold" | "silver" | "bronze" | "top10" | "default";

export const MEDAL_TIERS = ["gold", "silver", "bronze"] as const;

export const TOP_RANK_ACCENT_CUTOFF = 10;

export type MedalTier = (typeof MEDAL_TIERS)[number];

export const getRankTier = (rank: number): RankTier => {
  if (!Number.isInteger(rank) || rank < 1) return "default";
  if (rank <= MEDAL_TIERS.length) return MEDAL_TIERS[rank - 1];
  if (rank <= TOP_RANK_ACCENT_CUTOFF) return "top10";

  return "default";
};

export const isMedalTier = (tier: RankTier): tier is MedalTier =>
  (MEDAL_TIERS as readonly string[]).includes(tier);
