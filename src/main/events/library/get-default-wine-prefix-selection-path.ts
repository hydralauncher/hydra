import { logger, SystemPath } from "@main/services";
import fs from "node:fs";
import path from "node:path";
import { registerEvent } from "../register-event";

const getDefaultWinePrefixSelectionPath = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  try {
    const steamWinePrefixes = path.join(
      SystemPath.getPath("home"),
      ".local",
      "share",
      "Steam",
      "steamapps",
      "compatdata"
    );

    if (fs.existsSync(steamWinePrefixes)) {
      return fs.promises.realpath(steamWinePrefixes);
    }

    return null;
  } catch (err) {
    logger.error("Failed to get default wine prefix selection path", err);

    return null;
  }
};

registerEvent(
  "getDefaultWinePrefixSelectionPath",
  getDefaultWinePrefixSelectionPath
);
