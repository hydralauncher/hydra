import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const getCustomThemeById = async (
  _event: Electron.IpcMainInvokeEvent,
  themeId: string
) => {
  return themesSublevel.get(themeId);
};

registerEvent("getCustomThemeById", getCustomThemeById);
