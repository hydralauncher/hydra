import type { LocalNotification } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const localNotificationsSublevel = db.sublevel<
  string,
  LocalNotification
>(levelKeys.localNotifications, {
  valueEncoding: "json",
});
