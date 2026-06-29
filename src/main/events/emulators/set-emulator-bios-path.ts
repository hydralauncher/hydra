import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { registerEvent } from "../register-event";
import { emulators } from "@main/services";
import type { EmulatorSystem } from "@types";

const setEmulatorBiosPath = async (
  _event: Electron.IpcMainInvokeEvent,
  system: EmulatorSystem,
  biosPath: string | null
) => {
  let resolvedPath: string | null = null;
  if (biosPath) {
    const normalized = path.normalize(biosPath);
    if (existsSync(normalized) && statSync(normalized).isDirectory()) {
      resolvedPath = normalized;
    }
  }

  return emulators.updateEmulatorConfig(system, (current) => ({
    ...current,
    biosPath: resolvedPath,
  }));
};

registerEvent("setEmulatorBiosPath", setEmulatorBiosPath);
