import { existsSync } from "node:fs";

import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const checkRetroArchExecutable = async (
  _event: Electron.IpcMainInvokeEvent
): Promise<{ exists: boolean }> => {
  const config = await retroarch.getRetroArchConfig();
  if (!config.executablePath) return { exists: false };
  return { exists: existsSync(config.executablePath) };
};

registerEvent("checkRetroArchExecutable", checkRetroArchExecutable);
