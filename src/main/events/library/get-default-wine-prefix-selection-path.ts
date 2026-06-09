import { logger, Wine } from "@main/services";
import { registerEvent } from "../register-event";

const getDefaultWinePrefixSelectionPath = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  try {
    return Wine.getDefaultPrefixPath();
  } catch (err) {
    logger.error("Failed to get default wine prefix selection path", err);

    return null;
  }
};

registerEvent(
  "getDefaultWinePrefixSelectionPath",
  getDefaultWinePrefixSelectionPath
);
