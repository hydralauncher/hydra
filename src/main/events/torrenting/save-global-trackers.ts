import { db, levelKeys } from "@main/level";
import { registerEvent } from "../register-event";
import {
  clearGlobalTrackersMemoryCache,
  isValidTrackerUrl,
} from "@main/helpers";
import type { UserPreferences } from "@types";

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

  const trimmedUrl = url?.trim() ?? "";
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

  return {};
};

registerEvent("saveGlobalTrackers", saveGlobalTrackers);
