import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const openEditorWindow = async (_event: Electron.IpcMainInvokeEvent, themeId: string) => {
  WindowManager.openEditorWindow(themeId);
};

registerEvent("openEditorWindow", openEditorWindow);
