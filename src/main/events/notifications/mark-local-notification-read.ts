import { registerEvent } from "../register-event";
import { LocalNotificationManager } from "@main/services";

const markLocalNotificationRead = async (
  _event: Electron.IpcMainInvokeEvent,
  id: string
) => {
  await LocalNotificationManager.markAsRead(id);
};

registerEvent("markLocalNotificationRead", markLocalNotificationRead);
