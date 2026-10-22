import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { logger } from "@renderer/logger";
import { useUserDetails } from "@renderer/hooks";
import { getRequestKey } from "@renderer/helpers/response-cache";
import { leaderboardsCache } from "@renderer/services/leaderboards-cache";
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
    return null;
  }
};

export function useApiResource<T>(
  path: string | null,
  options: LeaderboardRequestOptions,
  normalize: (response: unknown) => T
): ApiResource<T> {
  const { viewerUser } = useLeaderboardViewer();
  const accountId = viewerUser?.id ?? null;
  const requestKey = path ? getRequestKey(path, options, accountId) : null;
  const [state, setState] = useState(() => {
    const data = readCached(path, options, accountId, normalize);
    return {
      key: requestKey,
      data,
      isLoading: Boolean(path) && data === null,
      hasError: false,
    };
  });
  const [attempt, setAttempt] = useState(0);
  const requestIdRef = useRef(0);
  const latest = useRef({ path, options, accountId, normalize });
  latest.current = { path, options, accountId, normalize };

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const {
      path: currentPath,
      options: currentOptions,
      accountId: currentAccountId,
    } = latest.current;

    if (!currentPath) {
      setState({ key: null, data: null, isLoading: false, hasError: false });
      return;
    }

    const cached = readCached(
      currentPath,
      currentOptions,
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

    leaderboardsCache
      .get(currentPath, currentOptions, currentAccountId)
      .then((response) => {
        if (requestId !== requestIdRef.current) return;
        setState({
          key: requestKey,
          data: latest.current.normalize(response),
          isLoading: false,
          hasError: false,
        });
      })
      .catch((error) => {
        if (requestId !== requestIdRef.current) return;
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
    const pending = readCached(path, options, accountId, normalize);
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
