/**
 * Extracting a game SKU from a PS2 memory card save-folder name.
 *
 * On-card save folders are named B<region><serial><game-suffix>, e.g.
 * BASCUS-97481GOWII, BASLUS-20294USER, BESLES-52988XXX. The serial is a
 * 4-letter publisher code + 5 digits; the game appends its own suffix directly
 * after it with no separator. So we strip the leading B<region> marker, match
 * the serial from the START, and drop the suffix — never anchor at the end.
 * System folders (BIEXEC-SYSTEM, BADATA-SYSTEM, BWNETCNF, …) carry no serial
 * and are skipped.
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
  // PS1-specific serial prefixes (memory cards are shared with PS1 saves).
  "SLED",
  "SCED",
  "SIPS",
  "ESPM",
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

  // Drop a leading B<region> marker, but only when a serial follows it (so a
  // bare serial is left intact, and "B" is never mistaken for part of a serial
  // — no PlayStation serial prefix begins with B).
  const body = u.replace(/^B[A-Z](?=[A-Z]{4}[-_ .]?\d{5})/, "");

  // Serial = 4-letter publisher code + optional separator + exactly 5 digits,
  // matched from the start. Any trailing game-specific suffix is ignored.
  const serial = /^([A-Z]{4})[-_ .]?(\d{5})/.exec(body);
  if (!serial || !KNOWN_PREFIXES.has(serial[1])) return null;

  return `${serial[1]}-${serial[2]}`;
};
