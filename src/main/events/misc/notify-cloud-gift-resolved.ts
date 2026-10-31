import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const notifyCloudGiftResolved = (
  _event: Electron.IpcMainInvokeEvent,
  giftId: string
) => {
  if (!giftId) return;

  WindowManager.sendToAppWindows("on-cloud-gift-resolved", giftId);
};

registerEvent("notifyCloudGiftResolved", notifyCloudGiftResolved);
