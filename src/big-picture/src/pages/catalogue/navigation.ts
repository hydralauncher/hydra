export const CATALOGUE_PAGE_REGION_ID = "catalogue-page";
export const CATALOGUE_GRID_REGION_ID = "catalogue-grid";
export const CATALOGUE_FILTERS_REGION_ID = "catalogue-filters";
export const CATALOGUE_LOADING_STATE_ID = "catalogue-loading-state";

export function getCatalogueCardFocusId(id: string) {
  return `catalogue-card:${id}`;
}

export function getCatalogueFilterInputFocusId(key: string) {
  return `catalogue-filter-input:${key}`;
}

export function getCatalogueFilterHeaderFocusId(key: string) {
  return `catalogue-filter-header:${key}`;
}

export function getCatalogueFilterCheckboxFocusId(key: string, value: string) {
  return `catalogue-filter-checkbox:${key}:${value}`;
}
