import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { logger } from "@renderer/logger";
import { useUserDetails } from "@renderer/hooks";
import type { GameShop } from "@types";
import { leaderboardsCache } from "@renderer/services/leaderboards-cache";
import {
  buildLeaderboardRequest,
  fetchGameLeaderboard,
  getLeaderboardBoardKey,
  isLeaderboardShop,
  selectLoadedLeaderboard,
  type LoadedLeaderboard,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type LeaderboardQuery,
  type LeaderboardScope,
  type LeaderboardUser,
} from "./game-leaderboard";

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
  const [loaded, setLoaded] = useState<LoadedLeaderboard | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [failedRequestKey, setFailedRequestKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const requestIdRef = useRef(0);

  const isLoggedIn = Boolean(userDetails);
  const isEligible = Boolean(objectId) && isLeaderboardShop(shop);
  const effectiveScope = isExtended && isLoggedIn ? scope : "global";
  const effectiveMetric = isExtended ? metric : "playtime";
  const viewerId = userDetails?.id ?? null;
  const boardKey = getLeaderboardBoardKey(shop, objectId ?? "", viewerId);
  const requestKey = `${boardKey}|${period}|${effectiveScope}|${effectiveMetric}|${attempt}`;

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
      setLoaded(null);
      setIsLoading(false);
      setFailedRequestKey(null);
      return;
    }

    const query: LeaderboardQuery = {
      shop,
      objectId,
      period,
      scope: effectiveScope,
      metric: effectiveMetric,
      isLoggedIn,
      viewerId,
    };

    setIsLoading(true);
    setFailedRequestKey(null);

    fetchGameLeaderboard(
      (path, options) => leaderboardsCache.get(path, options, viewerId),
      query
    )
      .then((leaderboard) => {
        if (requestId === requestIdRef.current) {
          setLoaded({
            boardKey: getLeaderboardBoardKey(
              query.shop,
              query.objectId,
              query.viewerId
            ),
            leaderboard,
            period: query.period,
            scope: query.scope,
            metric: query.metric,
          });
        }
      })
      .catch((error) => {
        const { path, options } = buildLeaderboardRequest(query);
        leaderboardsCache.evict(path, options, viewerId);
        if (requestId !== requestIdRef.current) return;
        logger.error("Failed to fetch game leaderboard", error);
        setLoaded(null);
        setFailedRequestKey(requestKey);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setIsLoading(false);
      });
  }, [
    attempt,
    effectiveMetric,
    effectiveScope,
    isEligible,
    isLoggedIn,
    objectId,
    period,
    requestKey,
    shop,
    viewerId,
  ]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const current = selectLoadedLeaderboard(loaded, boardKey, {
    period,
    scope: effectiveScope,
    metric: effectiveMetric,
  });

  return {
    leaderboard: current.leaderboard,
    dataPeriod: current.period,
    dataScope: current.scope,
    dataMetric: current.metric,
    isLoading,
    hasError: failedRequestKey === requestKey,
    isEligible,
    isLoggedIn,
    viewerUser,
    scope: effectiveScope,
    metric: effectiveMetric,
    retry,
  };
}
