import type { EmulationSavePlatform } from "@types";

import { getCloudSaveEmulatorProvider } from "../../../shared/cloud-save-emulator-provider.js";
import { launchboxPlatformByEmulationSavePlatform } from "../../../shared/emulation-save-v2-platform.js";

export const assertLegacyEmulationSaveWriteAllowed = (
  platform: EmulationSavePlatform,
  providerForPlatform = getCloudSaveEmulatorProvider
): void => {
  if (
    !Object.prototype.hasOwnProperty.call(
      launchboxPlatformByEmulationSavePlatform,
      platform
    )
  ) {
    throw new Error("invalid_emulation_save_platform");
  }
  if (
    providerForPlatform(
      "launchbox",
      launchboxPlatformByEmulationSavePlatform[platform]
    )
  ) {
    throw new Error("cloud_save_legacy_read_only");
  }
};
