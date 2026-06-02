import { registerEvent } from "../register-event";
import { LocalNotificationManager } from "@main/services";

const markLocalNotificationUnread = async (
  _event: Electron.IpcMainInvokeEvent,
  id: string
) => {
  await LocalNotificationManager.markAsUnread(id);
};

registerEvent("markLocalNotificationUnread", markLocalNotificationUnread);
