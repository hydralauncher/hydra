import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { logger } from "@renderer/logger";
import {
  buildGlobalLeaderboardRequest,
  GLOBAL_LEADERBOARD_METRICS,
  normalizeGlobalLeaderboardResponse,
  type GlobalLeaderboard,
  type GlobalLeaderboardMetric,
  type GlobalLeaderboardPeriod,
  type GlobalLeaderboardScope,
} from "./global-leaderboard";
import { leaderboardsCache } from "./leaderboards-api";

export interface GlobalBoardResult {
  leaderboard: GlobalLeaderboard | null;
  isLoading: boolean;
  hasError: boolean;
}

export type GlobalBoardResults = Record<
  GlobalLeaderboardMetric,
  GlobalBoardResult
>;

interface BoardsQuery {
  period: GlobalLeaderboardPeriod;
  scope: GlobalLeaderboardScope;
  isLoggedIn: boolean;
}

const readCachedBoard = (
  metric: GlobalLeaderboardMetric,
  query: BoardsQuery
): GlobalLeaderboard | null => {
  const { path, options } = buildGlobalLeaderboardRequest({
    metric,
    ...query,
  });
  const cached = leaderboardsCache.peek(path, options);
  if (cached === undefined) return null;

  try {
    return normalizeGlobalLeaderboardResponse(cached);
  } catch {
    return null;
  }
};

const readCachedBoards = (query: BoardsQuery) =>
  Object.fromEntries(
    GLOBAL_LEADERBOARD_METRICS.map((metric) => {
      const leaderboard = readCachedBoard(metric, query);
      return [
        metric,
        { leaderboard, isLoading: leaderboard === null, hasError: false },
      ];
    })
  ) as GlobalBoardResults;

export function useGlobalLeaderboards({
  period,
  scope,
  isLoggedIn,
}: BoardsQuery) {
  const queryKey = `${period}|${scope}|${isLoggedIn}`;
  const [state, setState] = useState(() => ({
    key: queryKey,
    results: readCachedBoards({ period, scope, isLoggedIn }),
  }));
  const [attempt, setAttempt] = useState(0);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const query = { period, scope, isLoggedIn };
    const initial = readCachedBoards(query);
    setState({ key: queryKey, results: initial });

    GLOBAL_LEADERBOARD_METRICS.forEach((metric) => {
      if (initial[metric].leaderboard) return;

      const { path, options } = buildGlobalLeaderboardRequest({
        metric,
        ...query,
      });

      leaderboardsCache
        .get(path, options)
        .then((response) => {
          if (requestId !== requestIdRef.current) return;
          const leaderboard = normalizeGlobalLeaderboardResponse(response);
          setState((current) => ({
            key: current.key,
            results: {
              ...current.results,
              [metric]: { leaderboard, isLoading: false, hasError: false },
            },
          }));
        })
        .catch((error) => {
          if (requestId !== requestIdRef.current) return;
          logger.error("Failed to fetch global leaderboard", error);
          setState((current) => ({
            key: current.key,
            results: {
              ...current.results,
              [metric]: { leaderboard: null, isLoading: false, hasError: true },
            },
          }));
        });
    });
  }, [attempt, isLoggedIn, period, queryKey, scope]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const pending = useMemo(
    () => readCachedBoards({ period, scope, isLoggedIn }),
    [isLoggedIn, period, scope]
  );

  return {
    results: state.key === queryKey ? state.results : pending,
    retry,
  };
}
