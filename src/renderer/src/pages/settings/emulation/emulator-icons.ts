import type { EmulatorBinary } from "@types";

import duckstationIcon from "@renderer/assets/emulation/icons/duckstation.png";
import pcsx2Icon from "@renderer/assets/emulation/icons/pcsx2.png";
import rpcs3Icon from "@renderer/assets/emulation/icons/rpcs3.png";

export const EMULATOR_ICONS: Partial<Record<EmulatorBinary, string>> = {
  duckstation: duckstationIcon,
  pcsx2: pcsx2Icon,
  rpcs3: rpcs3Icon,
};
