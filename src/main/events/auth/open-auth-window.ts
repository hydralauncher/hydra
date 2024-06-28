import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const openAuthWindow = async (_event: Electron.IpcMainInvokeEvent) =>
  WindowManager.openAuthWindow();

registerEvent("openAuthWindow", openAuthWindow);
