import type { RetroArchCoreName, RetroArchPlatform } from "@types";
import { PLATFORM_ROM_EXTENSIONS } from "../../../shared/retroarch-platform.js";

export interface RetroArchCoreDefinition {
  name: RetroArchCoreName;
  displayName: string;
  buildbotName: string;
  platforms: RetroArchPlatform[];
}

export const RETROARCH_CORES: Record<
  RetroArchCoreName,
  RetroArchCoreDefinition
> = {
  fceumm: {
    name: "fceumm",
    displayName: "FCEUmm",
    buildbotName: "fceumm",
    platforms: ["nes"],
  },
  snes9x: {
    name: "snes9x",
    displayName: "Snes9x",
    buildbotName: "snes9x",
    platforms: ["snes"],
  },
  mupen64plus_next: {
    name: "mupen64plus_next",
    displayName: "Mupen64Plus-Next",
    buildbotName: "mupen64plus_next",
    platforms: ["n64"],
  },
  gambatte: {
    name: "gambatte",
    displayName: "Gambatte",
    buildbotName: "gambatte",
    platforms: ["gb", "gbc"],
  },
  mgba: {
    name: "mgba",
    displayName: "mGBA",
    buildbotName: "mgba",
    platforms: ["gba"],
  },
};

export const RETROARCH_CORE_NAMES: readonly RetroArchCoreName[] = Object.keys(
  RETROARCH_CORES
) as RetroArchCoreName[];

export const RETROARCH_PLATFORMS: readonly RetroArchPlatform[] = [
  "nes",
  "snes",
  "n64",
  "gb",
  "gbc",
  "gba",
];

export const PLATFORM_TO_CORE: Record<RetroArchPlatform, RetroArchCoreName> = {
  nes: "fceumm",
  snes: "snes9x",
  n64: "mupen64plus_next",
  gb: "gambatte",
  gbc: "gambatte",
  gba: "mgba",
};

export { PLATFORM_ROM_EXTENSIONS } from "../../../shared/retroarch-platform.js";

export const PLATFORM_TO_LAUNCHBOX_NAME: Record<RetroArchPlatform, string> = {
  nes: "Nintendo Entertainment System",
  snes: "Super Nintendo Entertainment System",
  n64: "Nintendo 64",
  gb: "Nintendo Game Boy",
  gbc: "Nintendo Game Boy Color",
  gba: "Nintendo Game Boy Advance",
};

export const ALL_RETROARCH_ROM_EXTENSIONS: readonly string[] = Array.from(
  new Set(Object.values(PLATFORM_ROM_EXTENSIONS).flat())
);

export const extensionToPlatform = (
  fileName: string
): RetroArchPlatform | null => {
  const lower = fileName.toLowerCase();
  for (const platform of RETROARCH_PLATFORMS) {
    if (PLATFORM_ROM_EXTENSIONS[platform].some((ext) => lower.endsWith(ext))) {
      return platform;
    }
  }
  return null;
};

export const isRetroArchCoreName = (
  value: unknown
): value is RetroArchCoreName =>
  typeof value === "string" &&
  (RETROARCH_CORE_NAMES as readonly string[]).includes(value);

export const isRetroArchPlatform = (
  value: unknown
): value is RetroArchPlatform =>
  typeof value === "string" &&
  (RETROARCH_PLATFORMS as readonly string[]).includes(value);
