import type { CatalogueSearchPayload, GameShop } from "@types";
import type { CatalogueMode } from "../../../features/catalogue-search";
import { escapeHtmlText } from "../../../../../shared/rich-text.js";

export type StudioRole = "developers" | "publishers";

// The modern (Steam) catalogue stores names HTML-encoded ("&amp;"), while
// LaunchBox stores them as plain text, and the search matches exactly.
export function buildStudioCatalogueFilter(
  shop: GameShop,
  role: StudioRole,
  name: string
): { mode: CatalogueMode; filters: Partial<CatalogueSearchPayload> } {
  const isClassic = shop === "launchbox";

  return {
    mode: isClassic ? "classics" : "modern",
    filters: { [role]: [isClassic ? name : escapeHtmlText(name)] },
  };
}
