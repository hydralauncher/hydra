import { registerEvent } from "../register-event";
import { LocalNotificationManager } from "@main/services";

const clearAllLocalNotifications = async () => {
  await LocalNotificationManager.clearAll();
};

registerEvent("clearAllLocalNotifications", clearAllLocalNotifications);
