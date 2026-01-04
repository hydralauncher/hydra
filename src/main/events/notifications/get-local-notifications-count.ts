import { registerEvent } from "../register-event";
import { LocalNotificationManager } from "@main/services";

const getLocalNotificationsCount = async () => {
  return LocalNotificationManager.getUnreadCount();
};

registerEvent("getLocalNotificationsCount", getLocalNotificationsCount);
