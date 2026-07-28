import path from "node:path";

import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const setRetroArchCoresDir = async (
  _event: Electron.IpcMainInvokeEvent,
  coresDir: string | null
) => {
  const normalized = coresDir ? path.normalize(coresDir) : null;
  const resolvedDir = retroarch.resolveCoresDir(normalized);
  const detected = retroarch.detectInstalledCores(resolvedDir);

  return retroarch.updateRetroArchConfig((current) => {
    const cores = { ...current.cores };
    for (const core of retroarch.RETROARCH_CORE_NAMES) {
      const libraryPath = detected[core] ?? null;
      const previous = current.cores[core];
      if (libraryPath && previous?.path === libraryPath) {
        cores[core] = previous;
      } else {
        cores[core] = {
          name: core,
          installed: libraryPath !== null,
          version: null,
          path: libraryPath,
          installedAt: libraryPath ? Date.now() : null,
        };
      }
    }
    return { ...current, coresDir: normalized, cores };
  });
};

registerEvent("setRetroArchCoresDir", setRetroArchCoresDir);
