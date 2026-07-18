import type { FriendRequest, NotificationCountResponse } from "@types";
import { randomInt } from "node:crypto";
import { HydraApi } from "@main/services/hydra-api";
import { WindowManager } from "@main/services/window-manager";
import { logger } from "@main/services/logger";
import { ResyncCoordinator } from "./resync-coordinator";

type ResyncScope = "friends" | "friendRequests" | "notifications";

const ALL_SCOPES: ResyncScope[] = [
  "friends",
  "friendRequests",
  "notifications",
];
const RESYNC_JITTER_MS = 15_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();

    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });

const runResync = async (
  scopes: ReadonlySet<ResyncScope>,
  signal: AbortSignal,
  jitter: boolean
) => {
  let firstError: unknown;
  if (jitter) await sleep(randomInt(RESYNC_JITTER_MS + 1), signal);
  if (signal.aborted) return;

  if (scopes.has("friends")) {
    try {
      if (signal.aborted) return;
      WindowManager.sendToAppWindows("on-friends-updated");
    } catch (error) {
      firstError ??= error;
      logger.error(
        "Failed to broadcast friends update after reconnect:",
        error
      );
    }
  }

  if (signal.aborted) return;
  if (scopes.has("friendRequests")) {
    try {
      const friendRequests = await HydraApi.get<FriendRequest[]>(
        "/profile/friend-requests",
        undefined,
        { signal }
      );
      if (signal.aborted) return;
      WindowManager.sendToAppWindows("on-sync-friend-requests", {
        friendRequestCount: friendRequests.filter(
          (friendRequest) => friendRequest.type === "RECEIVED"
        ).length,
      });
    } catch (error) {
      if (signal.aborted) return;
      firstError ??= error;
      logger.error("Failed to resync friend requests:", error);
    }
  }

  if (signal.aborted) return;
  if (scopes.has("notifications")) {
    try {
      const { count } = await HydraApi.get<NotificationCountResponse>(
        "/profile/notifications/count",
        undefined,
        { signal }
      );
      if (signal.aborted) return;
      WindowManager.sendToAppWindows("on-sync-notification-count", {
        notificationCount: count,
      });
    } catch (error) {
      if (signal.aborted) return;
      firstError ??= error;
      logger.error("Failed to resync notification count:", error);
    }
  }

  if (firstError) throw firstError;
};

const coordinator = new ResyncCoordinator<ResyncScope>(runResync);

export const resyncAfterReconnect = (signal: AbortSignal) =>
  coordinator.request(ALL_SCOPES, signal, true);

export const resyncAfterEventFailure = (signal: AbortSignal) =>
  coordinator.request(ALL_SCOPES, signal);

export const resyncFriendRequests = (signal: AbortSignal) =>
  coordinator.request(["friendRequests"], signal);

export const resyncNotifications = (signal: AbortSignal) =>
  coordinator.request(["notifications"], signal);
