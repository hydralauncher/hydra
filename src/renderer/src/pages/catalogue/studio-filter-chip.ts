import type { CatalogueStudioFilter } from "../../features/catalogue-search";

// One chip stands for the studio as long as its filter still holds exactly the
// values the click set; any manual edit brings back one chip per value.
export const isStudioFilterShown = (
  studioFilter: CatalogueStudioFilter | null,
  key: CatalogueStudioFilter["key"],
  values: string[]
) =>
  studioFilter?.key === key &&
  studioFilter.values.length === values.length &&
  studioFilter.values.every((value) => values.includes(value));
