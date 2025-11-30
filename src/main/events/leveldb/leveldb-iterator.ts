import { registerEvent } from "../register-event";
import { getSublevelByName } from "./helpers";
import { logger } from "@main/services";

const leveldbIterator = async (
  _event: Electron.IpcMainInvokeEvent,
  sublevelName: string
) => {
  try {
    const sublevel = getSublevelByName(sublevelName);
    return sublevel.iterator().all();
  } catch (error) {
    logger.error("Error in leveldbIterator", error);
    throw error;
  }
};

registerEvent("leveldbIterator", leveldbIterator);
