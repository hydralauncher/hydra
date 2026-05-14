import type { EmulatorBinary } from "@types";

import duckstationIcon from "@renderer/assets/emulation/icons/duckstation.png";

export const EMULATOR_ICONS: Partial<Record<EmulatorBinary, string>> = {
  duckstation: duckstationIcon,
};
