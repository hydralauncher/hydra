import { WindowManager } from "@main/services";
import { registerEvent } from "../register-event";

const closeEditorWindow = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId?: string
) => {
  WindowManager.closeEditorWindow(themeId);
};

registerEvent("closeEditorWindow", closeEditorWindow);
