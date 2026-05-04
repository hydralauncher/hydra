import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const setFullScreen = async (
  _event: Electron.IpcMainInvokeEvent,
  flag: boolean
) => {
  WindowManager.mainWindow?.setFullScreen(flag);
};

registerEvent("setFullScreen", setFullScreen);
