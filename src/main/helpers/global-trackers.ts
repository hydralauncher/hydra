import axios from "axios";
import { db, levelKeys } from "@main/level";
import { logger } from "@main/services";
import type { UserPreferences } from "@types";

const VALID_PROTOCOLS = ["http:", "https:", "udp:"];
const MAX_TRACKER_LIST_SIZE = 50_000; // ~1,000 tracker URLs

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

export const getGlobalTrackers = async (): Promise<string[]> => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  return [
    ...new Set([
      ...(userPreferences?.appendGlobalTrackers
        ? (userPreferences?.globalTrackers ?? [])
        : []),
      ...(userPreferences?.appendGlobalTrackersUrl
        ? (userPreferences?.globalTrackersUrlCache ?? [])
        : []),
    ]),
  ];
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

  try {
    const trackers = await fetchGlobalTrackersFromUrl(startupUrl);

    const current = await db.get<string, UserPreferences | null>(
      levelKeys.userPreferences,
      { valueEncoding: "json" }
    );

    if (current?.globalTrackersUrl !== startupUrl) return;

    await db.put(
      levelKeys.userPreferences,
      { ...current, globalTrackersUrlCache: trackers },
      { valueEncoding: "json" }
    );
  } catch (err) {
    logger.error("Failed to refresh global tracker URL cache on startup", err);
  }
};
