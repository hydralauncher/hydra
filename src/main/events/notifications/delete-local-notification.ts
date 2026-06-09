import { registerEvent } from "../register-event";
import { LocalNotificationManager } from "@main/services";

const deleteLocalNotification = async (
  _event: Electron.IpcMainInvokeEvent,
  id: string
) => {
  await LocalNotificationManager.deleteNotification(id);
};

registerEvent("deleteLocalNotification", deleteLocalNotification);
