import { useEffect } from "react";
import type { LibraryGame } from "@types";

const ACHIEVEMENT_PROGRESS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ACHIEVEMENT_PROGRESS_SETTLE_MS = 250;

const requestedProgress = new Set<string>();

const needsCombinedProgress = (game: LibraryGame) => {
  const availableShops =
    "availableShops" in game && Array.isArray(game.availableShops)
      ? game.availableShops
      : [];
  const hasStoreUnion =
    availableShops.includes("steam") && availableShops.includes("epic");
  const borrowsSteamCatalogue =
    game.shop === "epic" &&
    (game.achievementCount ?? 0) <= 0 &&
    game.catalogueGame?.shop === "steam";

  return hasStoreUnion || borrowsSteamCatalogue;
};

export function useEnsureAchievementProgress(game: LibraryGame) {
  const needsProgress = needsCombinedProgress(game);
  const progressUpdatedAt = game.achievementProgress?.updatedAt ?? 0;
  const isFresh =
    Date.now() - progressUpdatedAt < ACHIEVEMENT_PROGRESS_MAX_AGE_MS;

  useEffect(() => {
    if (!needsProgress || isFresh) return;

    const key = `${game.shop}:${game.objectId}`;
    if (requestedProgress.has(key)) return;

    const timer = setTimeout(() => {
      requestedProgress.add(key);
      window.electron
        .ensureAchievementProgress(game.shop, game.objectId)
        .catch(() => requestedProgress.delete(key));
    }, ACHIEVEMENT_PROGRESS_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [game.objectId, game.shop, isFresh, needsProgress]);
}
