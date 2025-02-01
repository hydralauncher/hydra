import { themes } from "@main/level/sublevels/themes";
import { registerEvent } from "../register-event";

const getAllCustomThemes = async (_event: Electron.IpcMainInvokeEvent) => {
  return await themes.values().all();
};

registerEvent("getAllCustomThemes", getAllCustomThemes);
