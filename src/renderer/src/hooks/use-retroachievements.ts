import { useEffect, useState } from "react";
import type { GameShop, UserAchievement } from "@types";

interface UseRetroachievementsOptions {
  objectId?: string;
  shop?: GameShop;
  retroachievementsGameId?: number;
}

interface UseRetroachievementsReturn {
  achievements: UserAchievement[] | null;
  isLoading: boolean;
  error: Error | null;
}

export const useRetroachievements = ({
  objectId,
  shop,
  retroachievementsGameId,
}: UseRetroachievementsOptions): UseRetroachievementsReturn => {
  const [achievements, setAchievements] = useState<UserAchievement[] | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!objectId || !shop || !retroachievementsGameId) {
      return;
    }

    const fetchAchievements = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const result = await window.electron.getRetroachievements(
          objectId,
          shop,
          retroachievementsGameId
        );

        setAchievements(result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        setAchievements([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAchievements();
  }, [objectId, shop, retroachievementsGameId]);

  return { achievements, isLoading, error };
};
