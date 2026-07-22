import type { FriendRequest } from "../types";
import { HydraApi } from "@main/services/hydra-api";
import { publishNewFriendRequestNotification } from "@main/services/notifications";
import { resyncFriendRequests } from "../resync";
import type { UserProfile } from "@types";

export const friendRequestEvent = async (
  payload: FriendRequest,
  signal: AbortSignal
) => {
  await resyncFriendRequests(signal);
  if (signal.aborted) return;

  if (payload.senderId) {
    const user = await HydraApi.get<UserProfile>(
      `/users/${payload.senderId}`,
      undefined,
      { signal }
    );

    if (user && !signal.aborted) {
      await publishNewFriendRequestNotification(user, signal);
    }
  }
};
