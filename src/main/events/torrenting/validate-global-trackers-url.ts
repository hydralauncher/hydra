import { registerEvent } from "../register-event";
import { logger } from "@main/services";
import {
  fetchAndCacheGlobalTrackersUrl,
  isValidTrackerUrl,
} from "@main/helpers";

const validateGlobalTrackersUrl = async (
  _event: Electron.IpcMainInvokeEvent,
  url: string
): Promise<{ error?: string; count?: number }> => {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return { error: "global_trackers_fetch_error" };
  }

  if (!isValidTrackerUrl(trimmedUrl)) {
    return { error: "global_trackers_fetch_error" };
  }

  const listUrl = new URL(trimmedUrl);
  if (listUrl.protocol !== "http:" && listUrl.protocol !== "https:") {
    return { error: "global_trackers_fetch_error" };
  }

  try {
    const trackers = await fetchAndCacheGlobalTrackersUrl(trimmedUrl);
    return { count: trackers.length };
  } catch (err) {
    logger.error("Failed to validate global tracker URL", err);
    return { error: "global_trackers_fetch_error" };
  }
};

registerEvent("validateGlobalTrackersUrl", validateGlobalTrackersUrl);
