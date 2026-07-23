import axios from "axios";
import { db, levelKeys } from "@main/level";
import type { UserPreferences } from "@types";

const VALID_PROTOCOLS = ["http:", "https:", "udp:"];
const MAX_TRACKER_LIST_SIZE = 1_000; // ~1 KB

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
    maxBodyLength: MAX_TRACKER_LIST_SIZE,
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
    ...(userPreferences?.appendGlobalTrackers
      ? (userPreferences?.globalTrackers ?? [])
      : []),
    ...(userPreferences?.appendGlobalTrackersUrl
      ? (userPreferences?.globalTrackersUrlCache ?? [])
      : []),
  ];
};
