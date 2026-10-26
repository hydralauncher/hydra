import type { Notification } from "../types";
import { resyncNotifications } from "../resync";
import { logger } from "@main/services/logger";
import { publishLeaderboardNotifications } from "@main/services/leaderboard-notifications";

export const notificationEvent = (
  _payload: Notification,
  signal: AbortSignal
) => {
  publishLeaderboardNotifications(signal).catch((error) => {
    if (!signal.aborted)
      logger.error("Failed to publish leaderboard notifications", error);
  });
  return resyncNotifications(signal);
};
