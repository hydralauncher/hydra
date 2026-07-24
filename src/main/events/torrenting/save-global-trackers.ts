import { db, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";
import { clearGlobalTrackersMemoryCache } from "@main/helpers";
import { isValidTrackerUrl } from "@shared";
import type { UserPreferences } from "@types";

const saveGlobalTrackers = async (
  _event: Electron.IpcMainInvokeEvent,
  manual: string[],
  url: string | null,
  appendManual: boolean,
  appendUrl: boolean
): Promise<void> => {
  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  const trimmedUrl = url?.trim() ?? "";
  const validManual = [...new Set(manual.filter(isValidTrackerUrl))];

  try {
    await db.put(
      levelKeys.userPreferences,
      {
        ...userPreferences,
        globalTrackers: validManual,
        appendGlobalTrackers: appendManual,
        globalTrackersUrl: trimmedUrl,
        appendGlobalTrackersUrl: appendUrl,
      },
      { valueEncoding: "json" }
    );

    if (
      userPreferences &&
      (!appendUrl ||
        !trimmedUrl ||
        trimmedUrl !== userPreferences.globalTrackersUrl)
    ) {
      await db.del(levelKeys.globalTrackersUrlCache).catch(() => {});
    }
  } finally {
    clearGlobalTrackersMemoryCache();
  }
};

registerEvent("saveGlobalTrackers", saveGlobalTrackers);
