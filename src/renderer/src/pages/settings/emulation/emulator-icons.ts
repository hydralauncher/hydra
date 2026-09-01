import type { EmulatorBinary } from "@types";

import duckstationIcon from "@renderer/assets/emulation/icons/duckstation.png";
import retroarchIcon from "@renderer/assets/emulation/icons/retroarch.png";
import pcsx2Icon from "@renderer/assets/emulation/icons/pcsx2.png";
import rpcs3Icon from "@renderer/assets/emulation/icons/rpcs3.png";
import ppssppIcon from "@renderer/assets/emulation/psp.svg?url";
import dolphinIcon from "@renderer/assets/emulation/dolphin.svg?url";

export const EMULATOR_ICONS: Partial<Record<EmulatorBinary, string>> = {
  duckstation: duckstationIcon,
  pcsx2: pcsx2Icon,
  rpcs3: rpcs3Icon,
  ppsspp: ppssppIcon,
  dolphin: dolphinIcon,
};

export const RETROARCH_EMULATOR_ICON = retroarchIcon;
