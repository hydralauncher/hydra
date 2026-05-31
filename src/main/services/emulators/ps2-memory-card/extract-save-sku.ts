import { normalize } from "../sku-normalize";

/**
 * Extracting a game SKU from a PS2 memory card save-folder name.
 *
 * On-card save folders are named `B<region><serial>`, e.g. `BESLES-50009`,
 * `BASLUS-20552`, `BISLPM-65530`. We must NOT blindly drop the first two
 * characters — system folders (`BIEXEC-SYSTEM`, `BADATA-SYSTEM`, `BWNETCNF`, …)
 * follow the same shape but carry no game serial.
 *
 * Strategy: reject known system folders first, strip the `B<region>` prefix only
 * when the remainder looks like a serial, normalize to `XXXX-NNNNN`, then accept
 * only if the 4-letter prefix is a known PS1/PS2 publisher code.
 */

// Known PlayStation disc serial prefixes (SC* = Sony first-party, SL* = licensed,
// regional/3rd-party variants included).
const KNOWN_PREFIXES = new Set([
  "SLUS",
  "SLES",
  "SLPS",
  "SLPM",
  "SCUS",
  "SCES",
  "SCPS",
  "SCAJ",
  "SLAJ",
  "SLKA",
  "SCKA",
  "TCPS",
  "PBPX",
  "CPCS",
  "PAPX",
  "TLES",
  "TLUS",
  "TCES",
  "ALCH",
  "HAKU",
]);

// Second letter of the `B<region>` prefix: A=America, E=Europe, I/J=Japan,
// K=Korea, C=China, plus a few seen in the wild.
const REGION_SECOND_LETTERS = new Set([
  "A",
  "E",
  "I",
  "J",
  "K",
  "C",
  "P",
  "H",
  "U",
  "X",
]);

/**
 * True for memory-card folders that are NOT game saves (BIOS/system/network/
 * shared-data folders, PocketStation, `.`/`..`). These are skipped entirely.
 */
export const isSystemSaveFolder = (folderName: string): boolean => {
  const u = folderName.trim().toUpperCase();
  if (!u || u === "." || u === "..") return true;
  if (u.endsWith("-SYSTEM")) return true; // BIEXEC-SYSTEM, B?DATA-SYSTEM, …
  if (u.startsWith("BWNETCNF")) return true; // network configuration
  if (u === "BIOS" || u.startsWith("BOOT")) return true;
  // Shared/system data blobs written by the BIOS browser.
  if (
    u.startsWith("BADATA") ||
    u.startsWith("BEDATA") ||
    u.startsWith("BIDATA") ||
    u.startsWith("BJDATA")
  ) {
    return true;
  }
  if (u.startsWith("POCKETSTN") || u.startsWith("POCKETSTATION")) return true;
  return false;
};

export const extractSkuFromSaveFolder = (folderName: string): string | null => {
  const u = folderName.trim().toUpperCase();
  if (!u || isSystemSaveFolder(u)) return null;

  let candidate: string | null = null;

  // `B<region>` + serial, e.g. BESLES-50009 -> SLES-50009.
  const prefixed = u.match(/^B([A-Z])((?:[A-Z]{4})[-_ ]?\d{3,5})$/);
  if (prefixed && REGION_SECOND_LETTERS.has(prefixed[1])) {
    candidate = prefixed[2];
  } else {
    // Already-bare serial (homebrew/odd dumps): SLUS-20552 / SLUS_205.52 / SLUS20552.
    const bare = u.match(/^([A-Z]{4}[-_ ]?\d{3}[-_ .]?\d{2})$/);
    if (bare) candidate = bare[1];
  }

  if (!candidate) return null;

  const normalized = normalize(candidate); // -> "SLES-50009"
  const m = normalized.match(/^([A-Z]{4})-(\d+)$/);
  if (!m || !KNOWN_PREFIXES.has(m[1])) return null;
  return normalized;
};
