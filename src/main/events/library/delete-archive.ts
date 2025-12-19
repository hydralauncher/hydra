import fs from "node:fs";

import { registerEvent } from "../register-event";
import { logger } from "@main/services";

const deleteArchive = async (
  _event: Electron.IpcMainInvokeEvent,
  filePath: string
) => {
  try {
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      logger.info(`Deleted archive: ${filePath}`);
      return true;
    }
    return true;
  } catch (err) {
    logger.error(`Failed to delete archive: ${filePath}`, err);
    return false;
  }
};

registerEvent("deleteArchive", deleteArchive);
