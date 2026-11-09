import type {
  EmulatorConfig,
  EmulatorSaveLocationStatus,
  EmulatorSystem,
} from "@types";

export interface EmulatorSaveLocation {
  keyPrefix: "rpcs3_config" | "shadps4_data_dir";
  getStatus: () => Promise<EmulatorSaveLocationStatus>;
  select: (dir: string) => Promise<EmulatorConfig>;
  selectedDir: (config: EmulatorConfig) => string | null | undefined;
}

const RPCS3: EmulatorSaveLocation = {
  keyPrefix: "rpcs3_config",
  getStatus: () => window.electron.getRpcs3ConfigRootStatus(),
  select: (dir) => window.electron.setRpcs3ConfigRoot(dir),
  selectedDir: (config) => config.rpcs3ConfigRoot,
};

const SHADPS4: EmulatorSaveLocation = {
  keyPrefix: "shadps4_data_dir",
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
