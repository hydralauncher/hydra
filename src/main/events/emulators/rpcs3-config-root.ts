import { registerEvent } from "../register-event";
import {
  getEmulatorConfig,
  updateEmulatorConfig,
} from "@main/services/emulators/emulators-repository";
import {
  resolveRpcs3ConfigRootStatus,
  validateRpcs3ConfigRoot,
} from "@main/services/cloud-save/rpcs3-config-root";

const getRpcs3ConfigRootStatus = async () => {
  const config = await getEmulatorConfig("ps3");
  return (
    await resolveRpcs3ConfigRootStatus(
      config.executablePath,
      config.rpcs3ConfigRoot
    )
  ).status;
};

const setRpcs3ConfigRoot = async (
  _event: Electron.IpcMainInvokeEvent,
  root: string
) => {
  const config = await getEmulatorConfig("ps3");
  if (!config.executablePath) {
    throw new Error("cloud_save_rpcs3_not_configured");
  }
  const location = await validateRpcs3ConfigRoot(root);
  if (!location) {
    throw new Error("cloud_save_rpcs3_config_invalid_selection");
  }
  return updateEmulatorConfig("ps3", (current) => {
    if (current.executablePath !== config.executablePath) {
      throw new Error("cloud_save_rpcs3_not_configured");
    }
    return { ...current, rpcs3ConfigRoot: location.configRoot };
  });
};

registerEvent("getRpcs3ConfigRootStatus", getRpcs3ConfigRootStatus);
registerEvent("setRpcs3ConfigRoot", setRpcs3ConfigRoot);
