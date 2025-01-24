import { themes } from "@main/level/sublevels/themes";
import { registerEvent } from "../register-event";

const deleteCustomTheme = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string
) => {
  await themes.del(themeId);
};

registerEvent("deleteCustomTheme", deleteCustomTheme);
