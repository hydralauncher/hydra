import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const injectCSS = async (
  _event: Electron.IpcMainInvokeEvent,
  cssString: string
) => {
  WindowManager.mainWindow?.webContents.send("css-injected", cssString);
};

registerEvent("injectCSS", injectCSS);
