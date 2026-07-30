import { existsSync } from "node:fs";

import { registerEvent } from "../register-event";
import { retroarch } from "@main/services";

const coreFileMissing = (core: {
  installed: boolean;
  path: string | null;
}): boolean => core.installed && (!core.path || !existsSync(core.path));

const getRetroArchConfig = async (_event: Electron.IpcMainInvokeEvent) => {
  const config = await retroarch.getRetroArchConfig();

  const hasStaleCores = Object.values(config.cores).some(coreFileMissing);
  if (!hasStaleCores) return config;

  return retroarch.updateRetroArchConfig((current) => {
    const cores = { ...current.cores };
    for (const core of Object.values(current.cores)) {
      if (!coreFileMissing(core)) continue;
      cores[core.name] = {
        name: core.name,
        installed: false,
        version: null,
        path: null,
        installedAt: null,
      };
    }
    return { ...current, cores };
  });
};

registerEvent("getRetroArchConfig", getRetroArchConfig);
