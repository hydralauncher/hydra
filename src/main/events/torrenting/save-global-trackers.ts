import axios from "axios";
import { db, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";
import type { UserPreferences } from "@types";

const VALID_PROTOCOLS = ["http:", "https:", "udp:"];

const isValidTrackerUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return VALID_PROTOCOLS.includes(parsed.protocol);
  } catch {
    return false;
  }
};

const fetchAndValidateTrackersFromUrl = async (
  url: string
): Promise<string[]> => {
  const { data } = await axios.get<string>(url, {
    timeout: 15000,
    responseType: "text",
  });

  const lines = data
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return [...new Set(lines.filter(isValidTrackerUrl))];
};

const saveGlobalTrackers = async (
  _event: Electron.IpcMainInvokeEvent,
  manual: string[],
  url: string | null,
  appendManual: boolean,
  appendUrl: boolean
): Promise<{ error?: string }> => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  let urlCache: string[] = [];
  let error: string | undefined;

  const trimmedUrl = url?.trim() ?? "";
  const storedUrl = userPreferences?.globalTrackersUrl ?? "";
  const storedCache = userPreferences?.globalTrackersUrlCache ?? [];

  if (appendUrl && trimmedUrl) {
    if (trimmedUrl === storedUrl && storedCache.length > 0) {
      urlCache = storedCache;
    } else {
      try {
        urlCache = await fetchAndValidateTrackersFromUrl(trimmedUrl);
      } catch {
        error = "global_trackers_fetch_error";
        urlCache = trimmedUrl === storedUrl ? storedCache : [];
      }
    }
  }

  await db.put(
    levelKeys.userPreferences,
    {
      ...(userPreferences ?? {}),
      globalTrackers: manual,
      appendGlobalTrackers: appendManual,
      globalTrackersUrl: url ?? "",
      appendGlobalTrackersUrl: appendUrl,
      globalTrackersUrlCache: urlCache,
    },
    { valueEncoding: "json" }
  );

  return { error };
};

registerEvent("saveGlobalTrackers", saveGlobalTrackers);
