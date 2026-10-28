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

// Errors that cross IPC keep only their message, so a 400 is accepted here
// and rethrown with its status for callers that react to it.
export class LeaderboardRequestError extends Error {
  constructor(readonly status: number) {
    super(`Leaderboard request failed with status ${status}`);
  }
}

const BAD_REQUEST_STATUS = 400;

const leaderboardsGet: ApiGet = (path, options) => {
  const source = takeSource(path, options);
  return globalThis.window.electron.hydraApi
    .getResponse<unknown>(path, {
      ...(source
        ? { ...options, params: { ...options.params, source } }
        : options),
      acceptedStatuses: [200, BAD_REQUEST_STATUS],
    })
    .then(({ status, data }) => {
      if (status === BAD_REQUEST_STATUS) {
        throw new LeaderboardRequestError(status);
      }
      return data;
    });
};

export const leaderboardsCache = createResponseCache(leaderboardsGet);
