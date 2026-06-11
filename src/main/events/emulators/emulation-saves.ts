import { registerEvent } from "../register-event";
import { emulators, logger } from "@main/services";
import type { EmulationCloudSave, EmulationSavePlatform } from "@types";

const listEmulationSaves = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  objectId?: string | null
): Promise<EmulationCloudSave[]> => {
  try {
    const config = await emulators.getEmulatorConfig(platform);
    return await emulators.listEmulationSaves(
      platform,
      emulators.toEmulationSaveEmulator(config.binary),
      objectId
    );
  } catch (err) {
    // No subscription / network / auth — the UI gates on subscription anyway.
    logger.log("Could not list emulation saves", err);
    return [];
  }
};

const deleteEmulationSave = async (
  _event: Electron.IpcMainInvokeEvent,
  saveId: string
): Promise<void> => {
  await emulators.deleteEmulationSave(saveId);
};

const updateEmulationSaveLabel = async (
  _event: Electron.IpcMainInvokeEvent,
  saveId: string,
  label: string
): Promise<EmulationCloudSave> => {
  return emulators.updateEmulationSave(saveId, { label });
};

registerEvent("listEmulationSaves", listEmulationSaves);
registerEvent("deleteEmulationSave", deleteEmulationSave);
registerEvent("updateEmulationSaveLabel", updateEmulationSaveLabel);
