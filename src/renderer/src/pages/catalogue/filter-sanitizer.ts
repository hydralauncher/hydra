/**
 * Normalizes and sanitizes developer, publisher, and genre/tag names
 * to merge duplicates, fix typos, and remove corrupt entries.
 */
export function sanitizeFilterName(
  name: string | null | undefined
): string | null {
  if (!name) return null;

  let cleaned = name.trim();

  // Remove common corrupt prefix/suffix noise characters (like leading/trailing #, brackets, etc.)
  let start = 0;
  while (start < cleaned.length && !/[a-zA-Z0-9]/.test(cleaned[start])) {
    start++;
  }
  let end = cleaned.length - 1;
  while (end >= start && !/[a-zA-Z0-9]/.test(cleaned[end])) {
    end--;
  }
  cleaned = start <= end ? cleaned.substring(start, end + 1) : "";

  if (cleaned.length <= 1) {
    return null;
  }

  // Remove duplicate/multiple spaces
  cleaned = cleaned.replace(/\s+/g, " ");

  // Normalizations for popular synonyms & formats
  const lower = cleaned.toLowerCase();

  // Co-op
  if (lower === "coop" || lower === "co-operative" || lower === "cooperative") {
    return "Co-op";
  }

  // Multiplayer
  if (lower === "multiplayer" || lower === "multi-player") {
    return "Multiplayer";
  }

  // Singleplayer
  if (lower === "singleplayer" || lower === "single-player") {
    return "Singleplayer";
  }

  // RPG / Action RPG normalizations
  if (
    lower === "action-rpg" ||
    lower === "action / rpg" ||
    lower === "actionrpg"
  ) {
    return "Action RPG";
  }

  // Sci-fi
  if (lower === "scifi" || lower === "sci fi" || lower === "sci-fi") {
    return "Sci-fi";
  }

  // PvP / PvE casing
  if (lower === "pvp") return "PvP";
  if (lower === "pve") return "PvE";

  // Retain original capitalization for other entries but return cleaned string
  return cleaned;
}

/**
 * Cleans a list of filter items, removing duplicates and null values.
 */
export function sanitizeFilterList(items: string[]): string[] {
  const uniqueItems = new Set<string>();

  for (const item of items) {
    const sanitized = sanitizeFilterName(item);
    if (sanitized) {
      uniqueItems.add(sanitized);
    }
  }

  return Array.from(uniqueItems).sort((a, b) => a.localeCompare(b));
}

export const ALLOWED_FEATURE_TAG_IDS = new Set<number>([
  4182, // Singleplayer
  3859, // Multiplayer
  1685, // Co-op
  3843, // Online Co-Op
  3841, // Local Co-Op
  7368, // Local Multiplayer
  10816, // Split Screen
  1775, // PvP
  6730, // PvE
  4508, // Co-op Campaign
  128, // Massively Multiplayer
  1754, // MMORPG
  4840, // 4 Player Local
  17770, // Asynchronous Multiplayer
]);

export function isAllowedFeature(tagId: number): boolean {
  return ALLOWED_FEATURE_TAG_IDS.has(tagId);
}
