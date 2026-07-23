import type { RetroArchCoreName } from "@types";

export interface RetroArchCoreMeta {
  name: RetroArchCoreName;
  label: string;
  platforms: string;
}

export const RETROARCH_CORE_LIST: RetroArchCoreMeta[] = [
  { name: "fceumm", label: "FCEUmm", platforms: "NES" },
  { name: "snes9x", label: "Snes9x", platforms: "SNES" },
  { name: "mupen64plus_next", label: "Mupen64Plus-Next", platforms: "N64" },
  { name: "gambatte", label: "Gambatte", platforms: "GB / GBC" },
  { name: "mgba", label: "mGBA", platforms: "GBA" },
];

export const RETROARCH_LABEL = "RetroArch";
