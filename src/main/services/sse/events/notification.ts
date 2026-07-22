import type { Notification } from "../types";
import { resyncNotifications } from "../resync";

export const notificationEvent = (
  _payload: Notification,
  signal: AbortSignal
) => resyncNotifications(signal);
