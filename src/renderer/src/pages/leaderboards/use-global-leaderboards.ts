import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { logger } from "@renderer/logger";
import {
  buildGlobalLeaderboardRequest,
  normalizeGlobalLeaderboardResponse,
  type GlobalLeaderboard,
  type GlobalLeaderboardPeriod,
  type GlobalLeaderboardScope,
} from "./global-leaderboard";
import { leaderboardsCache } from "@renderer/services/leaderboards-cache";

export interface GlobalBoardResult {
  leaderboard: GlobalLeaderboard | null;
  isLoading: boolean;
  hasError: boolean;
}

export type GlobalBoardResults = Partial<Record<string, GlobalBoardResult>>;

interface BoardsQuery {
  metrics: string[];
  period: GlobalLeaderboardPeriod;
  scope: GlobalLeaderboardScope;
  isLoggedIn: boolean;
  accountId: string | null;
}

export const EMPTY_BOARD_RESULT: GlobalBoardResult = {
  leaderboard: null,
  isLoading: true,
  hasError: false,
};

const readCachedBoard = (
  metric: string,
  query: BoardsQuery
): GlobalLeaderboard | null => {
  const { path, options } = buildGlobalLeaderboardRequest({
    metric,
    period: query.period,
    scope: query.scope,
    isLoggedIn: query.isLoggedIn,
  });
  const cached = leaderboardsCache.peek(path, options, query.accountId);
  if (cached === undefined) return null;

  try {
    return normalizeGlobalLeaderboardResponse(cached);
  } catch {
    leaderboardsCache.evict(path, options, query.accountId);
    return null;
  }
};

const readCachedBoards = (query: BoardsQuery): GlobalBoardResults =>
  Object.fromEntries(
    query.metrics.map((metric) => {
      const leaderboard = readCachedBoard(metric, query);
      return [
        metric,
        { leaderboard, isLoading: leaderboard === null, hasError: false },
      ];
    })
  );

export function useGlobalLeaderboards({
  metrics,
  period,
  scope,
  isLoggedIn,
  accountId,
}: BoardsQuery) {
  const metricsKey = metrics.join(",");
  const queryKey = `${metricsKey}|${period}|${scope}|${isLoggedIn}|${accountId}`;
  const [state, setState] = useState(() => ({
    key: queryKey,
    results: readCachedBoards({
      metrics,
      period,
      scope,
      isLoggedIn,
      accountId,
    }),
  }));
  const [attempt, setAttempt] = useState(0);
  const requestIdRef = useRef(0);
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const query = {
      metrics: metricsRef.current,
      period,
      scope,
      isLoggedIn,
      accountId,
    };
    const initial = readCachedBoards(query);
    setState({ key: queryKey, results: initial });

    query.metrics.forEach((metric) => {
      if (initial[metric]?.leaderboard) return;

      const { path, options } = buildGlobalLeaderboardRequest({
        metric,
        period,
        scope,
        isLoggedIn,
      });

      leaderboardsCache
        .get(path, options, accountId)
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
          leaderboardsCache.evict(path, options, accountId);
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
  }, [accountId, attempt, isLoggedIn, metricsKey, period, queryKey, scope]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const pending = useMemo(
    () => readCachedBoards({ metrics, period, scope, isLoggedIn, accountId }),
    [accountId, isLoggedIn, metrics, period, scope]
  );

  return {
    results: state.key === queryKey ? state.results : pending,
    retry,
  };
}
