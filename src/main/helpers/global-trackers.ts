import axios from "axios";
import { db, levelKeys } from "@main/level";
import { logger } from "@main/services";
import type { UserPreferences } from "@types";

const VALID_PROTOCOLS = ["http:", "https:", "udp:"];
const MAX_TRACKER_LIST_SIZE = 50_000; // ~1,000 tracker URLs
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

interface GlobalTrackersUrlCache {
  url: string;
  trackers: string[];
  updatedAt: number;
}

let cachedGlobalTrackers: {
  manual: string[];
  url: string;
  urlCache: string[];
  appendManual: boolean;
  appendUrl: boolean;
  result: string[];
} | null = null;

export const isValidTrackerUrl = (url: string): boolean => {
  try {
    return VALID_PROTOCOLS.includes(new URL(url).protocol);
  } catch {
    return false;
  }
};

export const fetchGlobalTrackersFromUrl = async (
  url: string
): Promise<string[]> => {
  const { data } = await axios.get<string>(url, {
    timeout: 15000,
    responseType: "text",
    maxContentLength: MAX_TRACKER_LIST_SIZE,
  });

  const lines = data
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return [...new Set(lines.filter(isValidTrackerUrl))];
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
  if (appendUrl && url) {
    const cache = await getGlobalTrackersUrlCache();
    if (cache?.url === url) {
      urlCache = cache.trackers;
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
  const currentCache = await getGlobalTrackersUrlCache();

  if (
    currentCache?.url === startupUrl &&
    Date.now() - currentCache.updatedAt < CACHE_TTL_MS
  ) {
    return;
  }

  try {
    const trackers = await fetchGlobalTrackersFromUrl(startupUrl);
    await setGlobalTrackersUrlCache({
      url: startupUrl,
      trackers,
      updatedAt: Date.now(),
    });
  } catch (err) {
    logger.error("Failed to refresh global tracker URL cache on startup", err);
  }
};

export const clearGlobalTrackersMemoryCache = () => {
  cachedGlobalTrackers = null;
};
