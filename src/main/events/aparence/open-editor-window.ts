import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const openEditorWindow = async (_event: Electron.IpcMainInvokeEvent) =>
  WindowManager.openEditorWindow();

registerEvent("openEditorWindow", openEditorWindow);
