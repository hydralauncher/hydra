import { existsSync } from "node:fs";

import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const checkEmulatorExecutable = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem
) => {
  const config = await emulators.getEmulatorConfig(system);
  if (!config.executablePath) return { exists: false };
  return { exists: existsSync(config.executablePath) };
};

registerEvent("checkEmulatorExecutable", checkEmulatorExecutable);
