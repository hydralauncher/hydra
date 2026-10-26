import type { LeaderboardRequestSource } from "@shared";
import { createResponseCache, type ApiGet } from "../helpers/response-cache";

const SOURCE_ATTRIBUTION_MS = 10_000;

let pendingSource: {
  path: string;
  source: LeaderboardRequestSource;
  expiresAt: number;
} | null = null;

export const attributeNextLeaderboardRequest = (
  path: string,
  source: LeaderboardRequestSource
) => {
  leaderboardsCache.evictPath(path);
  pendingSource = {
    path,
    source,
    expiresAt: Date.now() + SOURCE_ATTRIBUTION_MS,
  };
};

const takeSource = (path: string) => {
  if (!pendingSource || pendingSource.path !== path) return null;
  const { source, expiresAt } = pendingSource;
  pendingSource = null;
  return Date.now() <= expiresAt ? source : null;
};

const leaderboardsGet: ApiGet = (path, options) => {
  const source = takeSource(path);
  return globalThis.window.electron.hydraApi.get<unknown>(
    path,
    source ? { ...options, params: { ...options.params, source } } : options
  );
};

export const leaderboardsCache = createResponseCache(leaderboardsGet);
