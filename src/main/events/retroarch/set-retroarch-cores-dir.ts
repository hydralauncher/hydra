import path from "node:path";

import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const setRetroArchCoresDir = async (
  _event: Electron.IpcMainInvokeEvent,
  coresDir: string | null
) => {
  const normalized = coresDir ? path.normalize(coresDir) : null;

  return retroarch.updateRetroArchConfig((current) => ({
    ...current,
    coresDir: normalized,
    cores: retroarch.buildCoresStateForDir(normalized, current.cores),
  }));
};

registerEvent("setRetroArchCoresDir", setRetroArchCoresDir);
