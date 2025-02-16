import { registerEvent } from "../register-event";
import { WindowManager } from "@main/services";

const importTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  theme: string,
  author: string,
) => {
  WindowManager.mainWindow?.webContents.send("import-theme", theme, author);
};

registerEvent("importTheme", importTheme);
