import type { EmulatorSystem } from "@types";

export const EMULATOR_SAVE_LOCATION_KEY_PREFIXES = {
  ps3: "rpcs3_config",
  ps4: "shadps4_data_dir",
} as const satisfies Partial<Record<EmulatorSystem, string>>;

export type EmulatorSaveLocationKeyPrefix =
  (typeof EMULATOR_SAVE_LOCATION_KEY_PREFIXES)[keyof typeof EMULATOR_SAVE_LOCATION_KEY_PREFIXES];
