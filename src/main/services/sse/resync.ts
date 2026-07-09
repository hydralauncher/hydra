import type { FriendRequest, NotificationCountResponse } from "@types";
import { HydraApi } from "@main/services/hydra-api";
import { WindowManager } from "@main/services/window-manager";
import { logger } from "@main/services/logger";

const RESYNC_JITTER_MS = 15_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/* Renderers fetch their own state at mount, so this only runs on RE-connects,
   where pushes may have been missed while the stream was down. Each step is
   independent: one failed fetch must not block the others. */
export const resyncAfterReconnect = async () => {
  await sleep(Math.random() * RESYNC_JITTER_MS);

  try {
    WindowManager.sendToAppWindows("on-friends-updated");
  } catch (err) {
    logger.error("Failed to broadcast friends update after reconnect:", err);
  }

  try {
    const friendRequests = await HydraApi.get<FriendRequest[]>(
      "/profile/friend-requests"
    );

    WindowManager.sendToAppWindows("on-sync-friend-requests", {
      friendRequestCount: friendRequests.filter(
        (friendRequest) => friendRequest.type === "RECEIVED"
      ).length,
    });
  } catch (err) {
    logger.error("Failed to resync friend requests after reconnect:", err);
  }

  try {
    const { count } = await HydraApi.get<NotificationCountResponse>(
      "/profile/notifications/count"
    );

    WindowManager.sendToAppWindows("on-sync-notification-count", {
      notificationCount: count,
    });
  } catch (err) {
    logger.error("Failed to resync notification count after reconnect:", err);
  }
};
