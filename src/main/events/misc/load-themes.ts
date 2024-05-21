import { mountPath } from "@main/theme/path";
import { registerEvent } from "../register-event";
import { readJSONFiles } from "@main/theme";

const loadThemes = async (_event: Electron.IpcMainInvokeEvent) => {
  const themePath = mountPath(process.platform);
  return await readJSONFiles(themePath);
};

registerEvent("loadThemes", loadThemes);
