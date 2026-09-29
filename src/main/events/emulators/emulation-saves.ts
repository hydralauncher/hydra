import { registerEvent } from "../register-event";
import { emulators, logger } from "@main/services";
import type { EmulationCloudSave, EmulationSavePlatform } from "@types";
import { loadArchivedEmulationSaves } from "./archived-emulation-save-policy";

const listEmulationSaves = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  objectId?: string | null
): Promise<EmulationCloudSave[]> => {
  try {
    const config = await emulators.getEmulatorConfig(
      emulators.emulationSavePlatformToSystem(platform)
    );
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

const listArchivedEmulationSavesForGame = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  objectId: string
): Promise<EmulationCloudSave[]> => {
  if (!objectId) return [];
  return loadArchivedEmulationSaves(
    platform,
    objectId,
    emulators.listEmulationSaves
  );
};

const listArchivedEmulationSavesForPlatform = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform
): Promise<EmulationCloudSave[]> => {
  return loadArchivedEmulationSaves(
    platform,
    null,
    emulators.listEmulationSaves
  );
};

const updateEmulationSaveLabel = async (
  _event: Electron.IpcMainInvokeEvent,
  saveId: string,
  label: string
): Promise<EmulationCloudSave> => {
  return emulators.updateEmulationSave(saveId, { label });
};

registerEvent("listEmulationSaves", listEmulationSaves);
registerEvent(
  "listArchivedEmulationSavesForGame",
  listArchivedEmulationSavesForGame
);
registerEvent(
  "listArchivedEmulationSavesForPlatform",
  listArchivedEmulationSavesForPlatform
);
registerEvent("deleteEmulationSave", deleteEmulationSave);
registerEvent("updateEmulationSaveLabel", updateEmulationSaveLabel);
