import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { logger } from "@renderer/logger";
import { useUserDetails } from "@renderer/hooks";
import type { GameShop } from "@types";
import {
  createLeaderboardFetcher,
  isLeaderboardShop,
  type Leaderboard,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type LeaderboardQuery,
  type LeaderboardScope,
  type LeaderboardUser,
} from "./game-leaderboard";

let fetchLeaderboard: ReturnType<typeof createLeaderboardFetcher> | null = null;

const getFetcher = () => {
  fetchLeaderboard ??= createLeaderboardFetcher((path, options) =>
    globalThis.window.electron.hydraApi.get<unknown>(path, options)
  );

  return fetchLeaderboard;
};

export interface UseGameLeaderboardOptions {
  shop: GameShop;
  objectId: string | undefined;
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  metric: LeaderboardMetric;
  isExtended: boolean;
}

export function useGameLeaderboard({
  shop,
  objectId,
  period,
  scope,
  metric,
  isExtended,
}: UseGameLeaderboardOptions) {
  const { userDetails } = useUserDetails();
  const [leaderboard, setLeaderboard] = useState<Leaderboard | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const requestIdRef = useRef(0);

  const isLoggedIn = Boolean(userDetails);
  const isEligible = Boolean(objectId) && isLeaderboardShop(shop);
  const effectiveScope = isExtended && isLoggedIn ? scope : "global";
  const effectiveMetric = isExtended ? metric : "playtime";

  const viewerUser = useMemo<LeaderboardUser | null>(
    () =>
      userDetails
        ? {
            id: userDetails.id,
            displayName: userDetails.displayName,
            profileImageUrl: userDetails.profileImageUrl,
            backgroundImageUrl: userDetails.backgroundImageUrl,
          }
        : null,
    [userDetails]
  );

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    if (!isEligible || !objectId) {
      setLeaderboard(null);
      setIsLoading(false);
      setHasError(false);
      return;
    }

    const query: LeaderboardQuery = {
      shop,
      objectId,
      period,
      scope: effectiveScope,
      metric: effectiveMetric,
      isExtended,
      isLoggedIn,
    };

    setIsLoading(true);
    setHasError(false);

    getFetcher()(query)
      .then((result) => {
        if (requestId === requestIdRef.current) setLeaderboard(result);
      })
      .catch((error) => {
        if (requestId !== requestIdRef.current) return;
        logger.error("Failed to fetch game leaderboard", error);
        setLeaderboard(null);
        setHasError(true);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setIsLoading(false);
      });
  }, [
    attempt,
    effectiveMetric,
    effectiveScope,
    isEligible,
    isExtended,
    isLoggedIn,
    objectId,
    period,
    shop,
  ]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return {
    leaderboard,
    isLoading,
    hasError,
    isEligible,
    isLoggedIn,
    viewerUser,
    scope: effectiveScope,
    metric: effectiveMetric,
    retry,
  };
}
