import { registerEvent } from "../register-event";
import { LocalNotificationManager } from "@main/services";

const markAllLocalNotificationsRead = async () => {
  await LocalNotificationManager.markAllAsRead();
};

registerEvent("markAllLocalNotificationsRead", markAllLocalNotificationsRead);
