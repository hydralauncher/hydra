import path from "node:path";

import { registerEvent } from "../register-event";
import { emulators, logger } from "@main/services";
import type {
  EmulationSavePlatform,
  MemcardRestoreResult,
  MemcardRestoreTarget,
} from "@types";

// Local cards a downloaded save can be written into (for the restore picker).
const getMemcardRestoreTargets = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform
): Promise<MemcardRestoreTarget[]> => {
  const config = await emulators.getEmulatorConfig(platform);
  const files =
    platform === "ps2"
      ? await emulators.resolvePs2MemcardFiles(config.executablePath)
      : await emulators.resolvePs1MemcardFiles(config.executablePath);
  return files.map((cardFilePath) => ({
    cardFilePath,
    cardLabel: path.basename(cardFilePath),
  }));
};

// Download the cloud save and write it back into the chosen local card.
const restoreEmulationSave = async (
  _event: Electron.IpcMainInvokeEvent,
  platform: EmulationSavePlatform,
  saveId: string,
  targetCardFilePath: string
): Promise<MemcardRestoreResult> => {
  try {
    const bytes = await emulators.downloadEmulationSaveBytes(saveId);
    const result =
      platform === "ps2"
        ? await emulators.importPsuIntoCard(targetCardFilePath, bytes)
        : await emulators.importMcsIntoCard(targetCardFilePath, bytes);
    return { ok: result.ok, error: result.error };
  } catch (err) {
    logger.error("Failed to restore emulation save", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

registerEvent("getMemcardRestoreTargets", getMemcardRestoreTargets);
registerEvent("restoreEmulationSave", restoreEmulationSave);
