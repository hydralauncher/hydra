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

export const PLATFORM_ROM_EXTENSIONS: Record<RetroArchPlatform, string[]> = {
  nes: [".nes", ".fds"],
  snes: [".sfc", ".smc"],
  n64: [".n64", ".z64", ".v64"],
  gb: [".gb"],
  gbc: [".gbc"],
  gba: [".gba"],
};

export const RETROARCH_ARCHIVE_EXTENSIONS = [".zip", ".7z"] as const;

export const getRetroArchRomExtensions = (
  platform: RetroArchPlatform
): string[] =>
  [...PLATFORM_ROM_EXTENSIONS[platform], ...RETROARCH_ARCHIVE_EXTENSIONS].map(
    (extension) => extension.slice(1)
  );
