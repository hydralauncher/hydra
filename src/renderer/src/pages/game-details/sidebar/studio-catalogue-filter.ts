import type { CatalogueSearchPayload, GameShop } from "@types";
import type { CatalogueMode } from "../../../features/catalogue-search";
import { escapeHtmlText } from "../../../../../shared/rich-text.js";

export type StudioRole = "developers" | "publishers";

// The modern (Steam) catalogue stores names HTML-encoded ("&amp;") and keeps a
// game's several developers or publishers as one comma-joined name
// ("FromSoftware, Inc., Bandai Namco Entertainment"). Its search matches whole
// names, ignoring case, and ORs the values of one filter. So the filter lists
// the name plus every stored combination that contains it.
// ponytail: substring scan of the full names list, drop it once the API stores
// each name separately.
const findNameVariants = (catalogueNames: string[], name: string) => {
  const needle = name.toLowerCase();
  const seen = new Set([needle]);
  const variants = [name];

  for (const candidate of catalogueNames) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;

    if (
      key.startsWith(`${needle}, `) ||
      key.endsWith(`, ${needle}`) ||
      key.includes(`, ${needle}, `)
    ) {
      seen.add(key);
      variants.push(candidate);
    }
  }

  return variants;
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
    filters: {
      [role]: findNameVariants(catalogueNames, escapeHtmlText(name)),
    },
  };
}
