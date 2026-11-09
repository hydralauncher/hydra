import path from "node:path";

import { registerEvent } from "../register-event";
import {
  getEmulatorConfig,
  updateEmulatorConfig,
} from "@main/services/emulators/emulators-repository";
import {
  resolveShadps4DataDirStatus,
  validateShadps4DataDir,
} from "@main/services/cloud-save/shadps4-data-dir";

const getShadps4DataDirStatus = async () => {
  const config = await getEmulatorConfig("ps4");
  return (
    await resolveShadps4DataDirStatus(
      config.executablePath,
      config.shadps4DataDir
    )
  ).status;
};

const setShadps4DataDir = async (
  _event: Electron.IpcMainInvokeEvent,
  dir: string | null
) => {
  const config = await getEmulatorConfig("ps4");
  if (!config.executablePath) {
    throw new Error("cloud_save_shadps4_not_configured");
  }
  if (dir !== null && typeof dir !== "string") {
    throw new Error("cloud_save_shadps4_config_invalid_selection");
  }
  const location = dir
    ? await validateShadps4DataDir(dir, path.dirname(config.executablePath))
    : null;
  if (dir && !location) {
    throw new Error("cloud_save_shadps4_config_invalid_selection");
  }
  return updateEmulatorConfig("ps4", (current) => {
    if (current.executablePath !== config.executablePath) {
      throw new Error("cloud_save_shadps4_not_configured");
    }
    return { ...current, shadps4DataDir: location?.dataDir ?? null };
  });
};

registerEvent("getShadps4DataDirStatus", getShadps4DataDirStatus);
registerEvent("setShadps4DataDir", setShadps4DataDir);
