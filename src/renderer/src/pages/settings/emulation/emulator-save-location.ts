import type {
  EmulatorConfig,
  EmulatorSaveLocationStatus,
  EmulatorSystem,
} from "@types";

import {
  EMULATOR_SAVE_LOCATION_KEY_PREFIXES,
  type EmulatorSaveLocationKeyPrefix,
} from "./emulator-save-location-keys";

export interface EmulatorSaveLocation {
  keyPrefix: EmulatorSaveLocationKeyPrefix;
  getStatus: () => Promise<EmulatorSaveLocationStatus>;
  select: (dir: string) => Promise<EmulatorConfig>;
  selectedDir: (config: EmulatorConfig) => string | null | undefined;
}

const RPCS3: EmulatorSaveLocation = {
  keyPrefix: EMULATOR_SAVE_LOCATION_KEY_PREFIXES.ps3,
  getStatus: () => window.electron.getRpcs3ConfigRootStatus(),
  select: (dir) => window.electron.setRpcs3ConfigRoot(dir),
  selectedDir: (config) => config.rpcs3ConfigRoot,
};

const SHADPS4: EmulatorSaveLocation = {
  keyPrefix: EMULATOR_SAVE_LOCATION_KEY_PREFIXES.ps4,
  getStatus: () => window.electron.getShadps4DataDirStatus(),
  select: (dir) => window.electron.setShadps4DataDir(dir),
  selectedDir: (config) => config.shadps4DataDir,
};

export const getEmulatorSaveLocation = (
  system: EmulatorSystem
): EmulatorSaveLocation | null => {
  switch (system) {
    case "ps3":
      return RPCS3;
    case "ps4":
      return SHADPS4;
    default:
      return null;
  }
};
