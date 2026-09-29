import type { EmulationSavePlatform } from "@types";
import { getEmulationSaveMenuMode } from "../../../../../shared/emulation-save-v2-platform.js";

export const canUploadLegacyEmulationSave = (
  platform: EmulationSavePlatform,
  hasActiveSubscription: boolean,
  menuModeForPlatform = getEmulationSaveMenuMode
) => hasActiveSubscription && menuModeForPlatform(platform) === "active";
