import { useEffect, useMemo, useState } from "react";
import { useLibrary } from "./use-library";
import { useUserDetails } from "./use-user-details";

// Platinum mirrors the same "100% completed" concept used for the in-game
// platinum achievement notification; gold/silver/bronze bucket a game's
// unlocked achievements by how far through that game the player is, since
// per-achievement rarity isn't available without fetching every library
// game's achievement list.
const XP_PER_BRONZE = 10;
const XP_PER_SILVER = 25;
const XP_PER_GOLD = 60;
const XP_PER_PLATINUM = 200;
const XP_PER_HOUR_PLAYED = 5;
const XP_PER_REVIEW = 30;
const HYDRA_CLOUD_REVIEW_XP_MULTIPLIER = 3;
const XP_LEVEL_FACTOR = 100;

const REVIEWED_GAMES_STORAGE_KEY = "hydra_xp_reviewed_games";
const REVIEW_XP_UPDATED_EVENT = "hydra:review-xp-updated";

const getReviewedGameKeys = (): string[] => {
  try {
    const raw = localStorage.getItem(REVIEWED_GAMES_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Called once a review is successfully submitted for a game. Stored as a
// deduped set of game keys (not a running counter) so re-submitting an edit
// to an already-reviewed game never grants XP twice.
export const recordGameReviewedForXp = (shop: string, objectId: string) => {
  const gameKey = `${shop}:${objectId}`;
  const existing = new Set(getReviewedGameKeys());
  if (existing.has(gameKey)) return;

  existing.add(gameKey);
  localStorage.setItem(
    REVIEWED_GAMES_STORAGE_KEY,
    JSON.stringify([...existing])
  );
  window.dispatchEvent(new CustomEvent(REVIEW_XP_UPDATED_EVENT));
};

const xpForLevel = (level: number) => XP_LEVEL_FACTOR * level * level;

export function useUserLevel() {
  const { library } = useLibrary();
  const { hasActiveSubscription } = useUserDetails();

  const [reviewedGameCount, setReviewedGameCount] = useState(
    () => getReviewedGameKeys().length
  );

  useEffect(() => {
    const handleUpdate = () =>
      setReviewedGameCount(getReviewedGameKeys().length);
    window.addEventListener(REVIEW_XP_UPDATED_EVENT, handleUpdate);
    return () =>
      window.removeEventListener(REVIEW_XP_UPDATED_EVENT, handleUpdate);
  }, []);

  const trophyStats = useMemo(() => {
    let platinum = 0;
    let gold = 0;
    let silver = 0;
    let bronze = 0;

    for (const game of library) {
      const achievementCount = game.achievementCount ?? 0;
      const unlockedCount = Math.min(
        game.unlockedAchievementCount ?? 0,
        achievementCount
      );
      if (achievementCount <= 0 || unlockedCount <= 0) continue;

      if (unlockedCount === achievementCount) platinum += 1;

      const progress = unlockedCount / achievementCount;
      if (progress >= 0.66) gold += unlockedCount;
      else if (progress >= 0.33) silver += unlockedCount;
      else bronze += unlockedCount;
    }

    return {
      platinum,
      gold,
      silver,
      bronze,
      total: platinum + gold + silver + bronze,
    };
  }, [library]);

  const totalPlaytimeMs = useMemo(() => {
    if (!library || library.length === 0) return 0;
    return library.reduce(
      (acc, game) => acc + (game.playTimeInMilliseconds || 0),
      0
    );
  }, [library]);

  // XP mirrors real trophy value (platinum worth the most, matching a full
  // game clear) plus a small amount per hour played, plus a bonus for every
  // game the user has reviewed (tripled for active Hydra Cloud subscribers).
  // Level requirements grow quadratically (xpForLevel(n) = 100 * n^2), the
  // same "each level costs more than the last" curve most XP-based games
  // use, so level/progress stay grounded in the player's actual activity
  // instead of an arbitrary number.
  const levelStats = useMemo(() => {
    const hoursPlayed = totalPlaytimeMs / (1000 * 60 * 60);
    const reviewXp =
      reviewedGameCount *
      XP_PER_REVIEW *
      (hasActiveSubscription ? HYDRA_CLOUD_REVIEW_XP_MULTIPLIER : 1);
    const totalXp = Math.round(
      trophyStats.platinum * XP_PER_PLATINUM +
        trophyStats.gold * XP_PER_GOLD +
        trophyStats.silver * XP_PER_SILVER +
        trophyStats.bronze * XP_PER_BRONZE +
        hoursPlayed * XP_PER_HOUR_PLAYED +
        reviewXp
    );

    const userLevel = Math.max(
      1,
      Math.floor(Math.sqrt(totalXp / XP_LEVEL_FACTOR))
    );
    const currentLevelXp = xpForLevel(userLevel);
    const nextLevelXp = xpForLevel(userLevel + 1);
    const xpNeededForLevel = nextLevelXp - currentLevelXp;
    const xpIntoLevel = Math.min(
      xpNeededForLevel,
      Math.max(0, totalXp - currentLevelXp)
    );
    const levelProgress =
      xpNeededForLevel > 0
        ? Math.min(100, Math.max(0, (xpIntoLevel / xpNeededForLevel) * 100))
        : 0;

    return {
      userLevel,
      levelProgress,
      xpIntoLevel,
      xpNeededForLevel,
      xpRemaining: Math.max(0, xpNeededForLevel - xpIntoLevel),
    };
  }, [trophyStats, totalPlaytimeMs, reviewedGameCount, hasActiveSubscription]);

  return { trophyStats, totalPlaytimeMs, ...levelStats };
}
