import { db, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";
import {
  clearGlobalTrackersMemoryCache,
  fetchGlobalTrackersFromUrl,
  getGlobalTrackersUrlCache,
  isValidTrackerUrl,
  setGlobalTrackersUrlCache,
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

  let error: string | undefined;

  const trimmedUrl = url?.trim() ?? "";
  const storedUrl = userPreferences?.globalTrackersUrl ?? "";

  let urlCache: string[] = [];
  if (appendUrl && trimmedUrl) {
    const storedCache = await getGlobalTrackersUrlCache();

    if (fetchUrl && trimmedUrl === storedUrl && storedCache?.url === storedUrl) {
      urlCache = storedCache.trackers;
    } else if (fetchUrl) {
      try {
        urlCache = await fetchGlobalTrackersFromUrl(trimmedUrl);
        await setGlobalTrackersUrlCache({
          url: trimmedUrl,
          trackers: urlCache,
          updatedAt: Date.now(),
        });
      } catch {
        error = "global_trackers_fetch_error";
        urlCache =
          storedCache?.url === trimmedUrl ? storedCache.trackers : [];
      }
    } else if (storedCache?.url === trimmedUrl) {
      urlCache = storedCache.trackers;
    }
  }

  const validManual = [...new Set(manual.filter(isValidTrackerUrl))];

  await db.put(
    levelKeys.userPreferences,
    {
      ...(userPreferences ?? {}),
      globalTrackers: validManual,
      appendGlobalTrackers: appendManual,
      globalTrackersUrl: trimmedUrl,
      appendGlobalTrackersUrl: appendUrl,
    },
    { valueEncoding: "json" }
  );

  clearGlobalTrackersMemoryCache();

  return { error };
};

registerEvent("saveGlobalTrackers", saveGlobalTrackers);
