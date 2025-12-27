import { registerEvent } from "../register-event";
import { db } from "@main/level";
import { getSublevelByName } from "./helpers";
import { logger } from "@main/services";

const leveldbPut = async (
  _event: Electron.IpcMainInvokeEvent,
  key: string,
  value: unknown,
  sublevelName?: string | null,
  valueEncoding: "json" | "utf8" = "json"
) => {
  try {
    if (sublevelName) {
      // Note: sublevels always use "json" encoding, valueEncoding parameter is ignored
      const sublevel = getSublevelByName(sublevelName);
      await sublevel.put(key, value);
    } else {
      await db.put<string, unknown>(key, value, { valueEncoding });
    }
  } catch (error) {
    logger.error("Error in leveldbPut", error);
    throw error;
  }
};

registerEvent("leveldbPut", leveldbPut);
