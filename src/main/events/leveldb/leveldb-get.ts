import { registerEvent } from "../register-event";
import { db } from "@main/level";
import { getSublevelByName } from "./helpers";
import { logger } from "@main/services";

const leveldbGet = async (
  _event: Electron.IpcMainInvokeEvent,
  key: string,
  sublevelName?: string | null,
  valueEncoding: "json" | "utf8" = "json"
) => {
  try {
    if (sublevelName) {
      // Note: sublevels always use "json" encoding, valueEncoding parameter is ignored
      const sublevel = getSublevelByName(sublevelName);
      return sublevel.get(key);
    }
    return db.get<string, unknown>(key, { valueEncoding });
  } catch (error) {
    if (error instanceof Error && error.name === "NotFoundError") {
      return null;
    }
    logger.error("Error in leveldbGet", error);
    throw error;
  }
};

registerEvent("leveldbGet", leveldbGet);
