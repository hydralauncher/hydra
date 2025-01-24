import { themes } from "@main/level/sublevels/themes";
import { registerEvent } from "../register-event";

const deleteAllCustomThemes = async (_event: Electron.IpcMainInvokeEvent) => {
  console.log("sexo2");
  await themes.clear();
};

registerEvent("deleteAllCustomThemes", deleteAllCustomThemes);
