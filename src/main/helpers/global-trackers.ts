import axios from "axios";
import { db, levelKeys } from "@main/level";
import { logger } from "@main/services";
import {
  isValidTrackerListUrl,
  isValidTrackerUrl,
  parseTrackerList,
} from "@shared";
import type { UserPreferences } from "@types";

const MAX_TRACKER_LIST_SIZE = 200_000; // ~4,000 tracker URLs
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const AXIOS_TIMEOUT_MS = 15_000;

interface GlobalTrackersUrlCache {
  url: string;
  trackers: string[];
  updatedAt: number;
}

const pendingUrlFetches = new Map<string, Promise<string[]>>();

const dedupedFetchAndCache = (url: string): Promise<string[]> => {
  if (!pendingUrlFetches.has(url)) {
    const promise = fetchAndCacheGlobalTrackersUrl(url);
    pendingUrlFetches.set(url, promise);
    promise.finally(() => pendingUrlFetches.delete(url));
  }
  return pendingUrlFetches.get(url)!;
};

let cachedGlobalTrackers: {
  manual: string[];
  url: string;
  urlCache: string[];
  appendManual: boolean;
  appendUrl: boolean;
  result: string[];
} | null = null;

export const fetchGlobalTrackersFromUrl = async (
  url: string
): Promise<string[]> => {
  if (!isValidTrackerListUrl(url)) {
    throw new Error("Invalid tracker URL");
  }

  const { data } = await axios.get<string>(url, {
    timeout: AXIOS_TIMEOUT_MS,
    responseType: "text",
    maxContentLength: MAX_TRACKER_LIST_SIZE,
  });

  return parseTrackerList(data).filter(isValidTrackerUrl);
};

export const getGlobalTrackersUrlCache =
  async (): Promise<GlobalTrackersUrlCache | null> => {
    return db.get<string, GlobalTrackersUrlCache | null>(
      levelKeys.globalTrackersUrlCache,
      { valueEncoding: "json" }
    );
  };

export const setGlobalTrackersUrlCache = async (
  value: GlobalTrackersUrlCache
) => {
  await db.put(levelKeys.globalTrackersUrlCache, value, {
    valueEncoding: "json",
  });
};

export const isGlobalTrackersUrlCacheStale = (
  cache: GlobalTrackersUrlCache | null | undefined,
  url: string
): boolean => {
  if (!cache || cache.url !== url) return true;
  return Date.now() - cache.updatedAt >= CACHE_TTL_MS;
};

export const fetchAndCacheGlobalTrackersUrl = async (
  url: string
): Promise<string[]> => {
  const trackers = await fetchGlobalTrackersFromUrl(url);
  await setGlobalTrackersUrlCache({
    url,
    trackers,
    updatedAt: Date.now(),
  });
  return trackers;
};

export const getGlobalTrackers = async (): Promise<string[]> => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const manual = userPreferences?.globalTrackers ?? [];
  const url = userPreferences?.globalTrackersUrl ?? "";
  const appendManual = userPreferences?.appendGlobalTrackers ?? false;
  const appendUrl = userPreferences?.appendGlobalTrackersUrl ?? false;

  let urlCache: string[] = [];
  if (appendUrl && url && isValidTrackerListUrl(url)) {
    const cache = await getGlobalTrackersUrlCache();
    if (cache?.url === url) {
      urlCache = cache.trackers;
    }

    if (isGlobalTrackersUrlCacheStale(cache, url)) {
      void dedupedFetchAndCache(url).catch((err) =>
        logger.error("Global tracker URL cache fetch/refresh failed", err)
      );
    }
  }

  if (
    cachedGlobalTrackers &&
    JSON.stringify(cachedGlobalTrackers.manual) === JSON.stringify(manual) &&
    cachedGlobalTrackers.url === url &&
    JSON.stringify(cachedGlobalTrackers.urlCache) ===
      JSON.stringify(urlCache) &&
    cachedGlobalTrackers.appendManual === appendManual &&
    cachedGlobalTrackers.appendUrl === appendUrl
  ) {
    return cachedGlobalTrackers.result;
  }

  const result = [
    ...new Set([
      ...(appendManual ? manual : []),
      ...(appendUrl ? urlCache : []),
    ]),
  ];

  cachedGlobalTrackers = {
    manual,
    url,
    urlCache,
    appendManual,
    appendUrl,
    result,
  };

  return result;
};

export const refreshGlobalTrackersUrlCache = async (): Promise<void> => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  if (
    !userPreferences?.appendGlobalTrackersUrl ||
    !userPreferences?.globalTrackersUrl
  ) {
    return;
  }

  const startupUrl = userPreferences.globalTrackersUrl;
  if (!isValidTrackerListUrl(startupUrl)) {
    return;
  }

  const currentCache = await getGlobalTrackersUrlCache();

  if (
    currentCache?.url === startupUrl &&
    !isGlobalTrackersUrlCacheStale(currentCache, startupUrl)
  ) {
    return;
  }

  try {
    await fetchAndCacheGlobalTrackersUrl(startupUrl);
    clearGlobalTrackersMemoryCache();
  } catch (err) {
    logger.error("Failed to refresh global tracker URL cache on startup", err);
  }
};

export const clearGlobalTrackersMemoryCache = () => {
  cachedGlobalTrackers = null;
};
