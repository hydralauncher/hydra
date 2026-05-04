import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const showFriendTestNotification = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  setTimeout(() => {
    WindowManager.showFriendTestNotification();
  }, 1000);
};

registerEvent("showFriendTestNotification", showFriendTestNotification);
