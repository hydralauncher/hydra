import { throttle } from "lodash-es";

export const FRIENDS_UPDATE_THROTTLE_MS = 10_000;

export const createFriendsUpdateThrottle = (send: () => void) =>
  throttle(send, FRIENDS_UPDATE_THROTTLE_MS, {
    leading: true,
    trailing: true,
  });
