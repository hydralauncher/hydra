import type { RetroArchPlatform } from "@types";

export const platformToRetroArchPlatform = (
  platform?: string | null
): RetroArchPlatform | null => {
  if (!platform) return null;
  const p = platform.toLowerCase();
  if (/game\s*boy\s*advance|\bgba\b/.test(p)) return "gba";
  if (/game\s*boy\s*color|\bgbc\b/.test(p)) return "gbc";
  if (/game\s*boy|\bgb\b/.test(p)) return "gb";
  if (/nintendo\s*64|\bn64\b/.test(p)) return "n64";
  if (/super\s*nintendo|\bsnes\b/.test(p)) return "snes";
  if (/nintendo\s*entertainment\s*system|\bnes\b|\bfamicom\b/.test(p))
    return "nes";
  return null;
};

export const RETROARCH_PLATFORM_LABELS: Record<RetroArchPlatform, string> = {
  nes: "NES",
  snes: "SNES",
  n64: "N64",
  gb: "GB",
  gbc: "GBC",
  gba: "GBA",
};
