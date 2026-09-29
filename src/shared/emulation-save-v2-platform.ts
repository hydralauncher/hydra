import type { EmulationSavePlatform } from "@types";

import { getCloudSaveEmulatorProvider } from "./cloud-save-emulator-provider.js";

export const launchboxPlatformByEmulationSavePlatform: Record<
  EmulationSavePlatform,
  string
> = {
  ps1: "Sony PlayStation",
  ps2: "Sony PlayStation 2",
  psp: "Sony PlayStation Portable",
  gamecube: "Nintendo GameCube",
  wii: "Nintendo Wii",
};

export const getEmulationSaveMenuMode = (
  platform: EmulationSavePlatform,
  providerForPlatform = getCloudSaveEmulatorProvider
): "archive" | "active" =>
  providerForPlatform(
    "launchbox",
    launchboxPlatformByEmulationSavePlatform[platform]
  )
    ? "archive"
    : "active";
