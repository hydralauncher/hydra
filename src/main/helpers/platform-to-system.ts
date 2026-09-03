import type { EmulatorSystem } from "@types";

export const platformToSystem = (
  platform?: string | null
): EmulatorSystem | null => {
  if (!platform) return null;
  const p = platform.toLowerCase();
  if (/playstation\s*portable|\bpsp\b/.test(p)) return "psp";
  if (/playstation\s*3|\bps3\b/.test(p)) return "ps3";
  if (/playstation\s*2|\bps2\b/.test(p)) return "ps2";
  if (/playstation|\bps1\b|\bpsx\b/.test(p)) return "ps1";
  if (/game\s*cube/.test(p)) return "dolphin";
  if (/^(nintendo\s+)?wii$/.test(p.trim())) return "dolphin";
  return null;
};
