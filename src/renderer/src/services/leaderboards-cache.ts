import type { LeaderboardRequestSource } from "@shared";
import {
  createResponseCache,
  type ApiGet,
  type ApiRequestOptions,
} from "../helpers/response-cache";

const SOURCE_ATTRIBUTION_MS = 10_000;

export interface LeaderboardAttribution {
  path: string;
  scope: string;
  period: string;
  source: LeaderboardRequestSource;
}

let pendingSource: (LeaderboardAttribution & { expiresAt: number }) | null =
  null;

export const attributeNextLeaderboardRequest = (
  attribution: LeaderboardAttribution
) => {
  leaderboardsCache.evictPath(attribution.path);
  pendingSource = {
    ...attribution,
    expiresAt: Date.now() + SOURCE_ATTRIBUTION_MS,
  };
};

const takeSource = (path: string, { params }: ApiRequestOptions) => {
  const pending = pendingSource;
  if (!pending) return null;
  if (Date.now() > pending.expiresAt) {
    pendingSource = null;
    return null;
  }
  if (
    pending.path !== path ||
    params.scope !== pending.scope ||
    (params.window ?? params.range) !== pending.period
  ) {
    return null;
  }
  pendingSource = null;
  return pending.source;
};

const leaderboardsGet: ApiGet = (path, options) => {
  const source = takeSource(path, options);
  return globalThis.window.electron.hydraApi.get<unknown>(
    path,
    source ? { ...options, params: { ...options.params, source } } : options
  );
};

export const leaderboardsCache = createResponseCache(leaderboardsGet);
