import { SystemPath } from "@main/services";
import fs from "node:fs";
import path from "node:path";
import { registerEvent } from "../register-event";

const getDefaultWinePrefixSelectionPath = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  const steamWinePrefixes = path.join(
    SystemPath.getPath("home"),
    ".local",
    "share",
    "Steam",
    "steamapps",
    "compatdata"
  );

  if (fs.existsSync(steamWinePrefixes)) {
    return steamWinePrefixes;
  }

  return null;
};

registerEvent(
  "getDefaultWinePrefixSelectionPath",
  getDefaultWinePrefixSelectionPath
);
