import type { CatalogueSearchPayload, GameShop } from "@types";
import type { CatalogueMode } from "../../../features/catalogue-search";
import {
  decodeHtmlText,
  escapeHtmlText,
} from "../../../../../shared/rich-text.js";

export type StudioRole = "developers" | "publishers";

// Store data comes from outside: keep distinct, non-blank strings only.
export const getStudioNames = (value: unknown): string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (name): name is string =>
              typeof name === "string" && name.trim() !== ""
          )
        ),
      ]
    : [];

// The modern (Steam) catalogue stores most names HTML-encoded ("&amp;") but
// some in plain text, and keeps a game's several developers or publishers as
// one comma-joined name ("FromSoftware, Inc., Bandai Namco Entertainment").
// Its search matches whole stored names, ignoring case, and ORs the values of
// one filter. So the filter lists every stored name that is the studio or
// contains it as a comma-separated part, exactly as stored.
// Limits: a linear scan of the full names list; generic names ("LIMITED")
// also match legal suffixes. Drop it once the API stores each name separately.
const findStoredNames = (catalogueNames: string[], name: string) => {
  const needle = name.toLowerCase();
  const seen = new Set<string>();
  const matches: string[] = [];

  for (const candidate of catalogueNames) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;

    const decoded = decodeHtmlText(key);
    if (
      decoded === needle ||
      decoded.startsWith(`${needle}, `) ||
      decoded.endsWith(`, ${needle}`) ||
      decoded.includes(`, ${needle}, `)
    ) {
      seen.add(key);
      matches.push(candidate);
    }
  }

  // Without the list (or a match), fall back to the usual stored encoding.
  return matches.length > 0 ? matches : [escapeHtmlText(name)];
};

export function buildStudioCatalogueFilter(
  shop: GameShop,
  role: StudioRole,
  name: string,
  catalogueNames: string[] = []
): { mode: CatalogueMode; filters: Partial<CatalogueSearchPayload> } {
  // LaunchBox keeps plain names, one per entry.
  if (shop === "launchbox") {
    return { mode: "classics", filters: { [role]: [name] } };
  }

  return {
    mode: "modern",
    filters: { [role]: findStoredNames(catalogueNames, name) },
  };
}
