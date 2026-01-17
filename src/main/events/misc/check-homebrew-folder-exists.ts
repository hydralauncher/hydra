import { registerEvent } from "../register-event";
import { DECKY_PLUGINS_LOCATION } from "@main/constants";
import fs from "node:fs";
import path from "node:path";

const checkHomebrewFolderExists = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<boolean> => {
  const homebrewPath = path.dirname(DECKY_PLUGINS_LOCATION);
  return fs.existsSync(homebrewPath);
};

registerEvent("checkHomebrewFolderExists", checkHomebrewFolderExists);
