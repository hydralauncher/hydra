import { themesSublevel } from "@main/level";
import { registerEvent } from "../register-event";

const deleteAllCustomThemes = async (_event: Electron.IpcMainInvokeEvent) => {
  await themesSublevel.clear();
};

registerEvent("deleteAllCustomThemes", deleteAllCustomThemes);
