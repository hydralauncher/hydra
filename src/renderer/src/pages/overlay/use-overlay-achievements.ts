import { useEffect, useState } from "react";

import type { OverlayGameInfo, UserAchievement } from "@types";

const electron = globalThis.electron as Electron;

interface OverlayAchievements {
  achievements: UserAchievement[];
}

export const useOverlayAchievements = (
  game: OverlayGameInfo | null,
  retroAchievementsWebApiKey: string | null | undefined
): OverlayAchievements => {
  const [achievements, setAchievements] = useState<UserAchievement[]>([]);

  useEffect(() => {
    if (!game) {
      setAchievements([]);
      return;
    }

    if (game.achievementCount === 0) {
      setAchievements([]);
      return;
    }

    let cancelled = false;

    const request =
      game.shop === "launchbox" && retroAchievementsWebApiKey
        ? electron.getRetroAchievementsAchievements(game.objectId, game.shop)
        : electron.getUnlockedAchievements(game.objectId, game.shop);

    request
      .then((result) => {
        if (cancelled) return;
        setAchievements(result ?? []);
      })
      .catch(() => {
        if (cancelled) return;
        setAchievements([]);
      });

    const unsubscribe = electron.onUpdateAchievements(
      game.objectId,
      game.shop,
      (updated) => {
        if (!cancelled) setAchievements(updated ?? []);
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [game, retroAchievementsWebApiKey]);

  return { achievements };
};
