import { registerEvent } from "../register-event";
import { LocalNotificationManager } from "@main/services";

const getLocalNotifications = async () => {
  return LocalNotificationManager.getNotifications();
};

registerEvent("getLocalNotifications", getLocalNotifications);
