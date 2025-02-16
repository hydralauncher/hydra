import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const getAllCustomThemes = async (_event: Electron.IpcMainInvokeEvent) => {
  return themesSublevel.values().all();
};

registerEvent("getAllCustomThemes", getAllCustomThemes);
