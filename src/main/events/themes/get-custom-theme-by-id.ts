import { themes } from "@main/level/sublevels/themes";
import { registerEvent } from "../register-event";

const getCustomThemeById = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string
) => {
  return await themes.get(themeId);
};

registerEvent("getCustomThemeById", getCustomThemeById);
