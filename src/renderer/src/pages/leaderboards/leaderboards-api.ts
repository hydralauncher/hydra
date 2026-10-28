import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { logger } from "@renderer/logger";
import { useUserDetails } from "@renderer/hooks";
import { getRequestKey } from "@renderer/helpers/response-cache";
import {
  leaderboardsCache,
  LeaderboardRequestError,
} from "@renderer/services/leaderboards-cache";
import type {
  LeaderboardRequestOptions,
  LeaderboardUser,
} from "../game-details/leaderboard/game-leaderboard";

export function useLeaderboardViewer() {
  const { userDetails } = useUserDetails();

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

  return { viewerUser, isLoggedIn: Boolean(viewerUser) };
}

export interface ApiResource<T> {
  data: T | null;
  isLoading: boolean;
  hasError: boolean;
  retry: () => void;
}

const readCached = <T>(
  path: string | null,
  options: LeaderboardRequestOptions,
  accountId: string | null,
  normalize: (response: unknown) => T
): T | null => {
  if (!path) return null;
  const cached = leaderboardsCache.peek(path, options, accountId);
  if (cached === undefined) return null;

  try {
    return normalize(cached);
  } catch {
    leaderboardsCache.evict(path, options, accountId);
    return null;
  }
};

export interface ApiFallback<T> {
  options: LeaderboardRequestOptions;
  normalize: (response: unknown) => T;
}

// Main requests the API rejected with a 400, so later visits in this session
// go straight to the fallback instead of failing first.
const rejectedRequests = new Set<string>();

const isRejected = (
  path: string | null,
  options: LeaderboardRequestOptions,
  accountId: string | null
) =>
  path !== null &&
  rejectedRequests.has(getRequestKey(path, options, accountId));

const readCachedWithFallback = <T>(
  path: string | null,
  options: LeaderboardRequestOptions,
  fallback: ApiFallback<T> | undefined,
  accountId: string | null,
  normalize: (response: unknown) => T
): T | null =>
  (isRejected(path, options, accountId)
    ? null
    : readCached(path, options, accountId, normalize)) ??
  (fallback
    ? readCached(path, fallback.options, accountId, fallback.normalize)
    : null);

// With `fallback`, a 400 from the main request is retried once with the
// fallback options, and only a 400: other errors are reported as usual.
export function useApiResource<T>(
  path: string | null,
  options: LeaderboardRequestOptions,
  normalize: (response: unknown) => T,
  fallback?: ApiFallback<T>
): ApiResource<T> {
  const { viewerUser } = useLeaderboardViewer();
  const accountId = viewerUser?.id ?? null;
  const requestKey = path ? getRequestKey(path, options, accountId) : null;
  const [state, setState] = useState(() => {
    const data = readCachedWithFallback(
      path,
      options,
      fallback,
      accountId,
      normalize
    );
    return {
      key: requestKey,
      data,
      isLoading: Boolean(path) && data === null,
      hasError: false,
    };
  });
  const [attempt, setAttempt] = useState(0);
  const requestIdRef = useRef(0);
  const latest = useRef({ path, options, fallback, accountId, normalize });
  latest.current = { path, options, fallback, accountId, normalize };

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const {
      path: currentPath,
      options: currentOptions,
      fallback: currentFallback,
      accountId: currentAccountId,
    } = latest.current;

    if (!currentPath) {
      setState({ key: null, data: null, isLoading: false, hasError: false });
      return;
    }

    const cached = readCachedWithFallback(
      currentPath,
      currentOptions,
      currentFallback,
      currentAccountId,
      latest.current.normalize
    );
    if (cached !== null) {
      setState({
        key: requestKey,
        data: cached,
        isLoading: false,
        hasError: false,
      });
      return;
    }

    setState((current) => ({
      key: requestKey,
      data: current.key === requestKey ? current.data : null,
      isLoading: true,
      hasError: false,
    }));

    const fetchFallback = () => {
      if (!currentFallback) throw new Error("No fallback request");
      return leaderboardsCache
        .get(currentPath, currentFallback.options, currentAccountId)
        .then(currentFallback.normalize);
    };
    const request =
      currentFallback &&
      isRejected(currentPath, currentOptions, currentAccountId)
        ? fetchFallback()
        : leaderboardsCache
            .get(currentPath, currentOptions, currentAccountId)
            .then((response) => latest.current.normalize(response))
            .catch((error: unknown) => {
              if (
                !currentFallback ||
                !(error instanceof LeaderboardRequestError) ||
                error.status !== 400
              ) {
                throw error;
              }
              rejectedRequests.add(
                getRequestKey(currentPath, currentOptions, currentAccountId)
              );
              return fetchFallback();
            });

    request
      .then((data) => {
        if (requestId !== requestIdRef.current) return;
        setState({ key: requestKey, data, isLoading: false, hasError: false });
      })
      .catch((error) => {
        if (requestId !== requestIdRef.current) return;
        leaderboardsCache.evict(currentPath, currentOptions, currentAccountId);
        logger.error("Failed to fetch leaderboard data", error);
        setState({
          key: requestKey,
          data: null,
          isLoading: false,
          hasError: true,
        });
      });
  }, [attempt, requestKey]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const isCurrent = state.key === requestKey;

  if (!isCurrent) {
    const pending = readCachedWithFallback(
      path,
      options,
      fallback,
      accountId,
      normalize
    );
    return {
      data: pending,
      isLoading: Boolean(path) && pending === null,
      hasError: false,
      retry,
    };
  }

  return {
    data: state.data,
    isLoading: state.isLoading,
    hasError: state.hasError,
    retry,
  };
}
