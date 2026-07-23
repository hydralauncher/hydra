import { db, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";
import {
  fetchGlobalTrackersFromUrl,
  isValidTrackerUrl,
} from "@main/helpers";
import type { UserPreferences } from "@types";

const saveGlobalTrackers = async (
  _event: Electron.IpcMainInvokeEvent,
  manual: string[],
  url: string | null,
  appendManual: boolean,
  appendUrl: boolean,
  fetchUrl: boolean = true
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
    if (fetchUrl && trimmedUrl === storedUrl && storedCache.length > 0) {
      urlCache = storedCache;
    } else if (fetchUrl) {
      try {
        urlCache = await fetchGlobalTrackersFromUrl(trimmedUrl);
      } catch {
        error = "global_trackers_fetch_error";
        urlCache = trimmedUrl === storedUrl ? storedCache : [];
      }
    } else {
      urlCache = storedCache;
    }
  }

  const validManual = [...new Set(manual.filter(isValidTrackerUrl))];

  await db.put(
    levelKeys.userPreferences,
    {
      ...(userPreferences ?? {}),
      globalTrackers: validManual,
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
