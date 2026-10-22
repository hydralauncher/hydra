import { createResponseCache, type ApiGet } from "../helpers/response-cache";

const leaderboardsGet: ApiGet = (path, options) =>
  globalThis.window.electron.hydraApi.get<unknown>(path, options);

export const leaderboardsCache = createResponseCache(leaderboardsGet);
