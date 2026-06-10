export const CATALOGUE_PAGE_REGION_ID = "catalogue-page";
export const CATALOGUE_HEADER_CONTROLS_REGION_ID = "catalogue-header-controls";
export const CATALOGUE_GRID_REGION_ID = "catalogue-grid";
export const CATALOGUE_EMPTY_STATE_ID = "catalogue-empty-state";
export const CATALOGUE_ERROR_STATE_ID = "catalogue-error-state";
export const CATALOGUE_FILTERS_BUTTON_ID = "catalogue-filters-button";
export const CATALOGUE_SORT_SELECT_ID = "catalogue-sort-select";
export const CATALOGUE_CLEAR_FILTERS_ID = "catalogue-clear-filters";
export const CATALOGUE_MODE_MODERN_ID = "catalogue-mode-modern";
export const CATALOGUE_MODE_CLASSICS_ID = "catalogue-mode-classics";
const CATALOGUE_CARD_FOCUS_ID_PREFIX = "catalogue-card:";

export function getCatalogueCardFocusId(id: string) {
  return `${CATALOGUE_CARD_FOCUS_ID_PREFIX}${id}`;
}

export function isCatalogueGridFocusId(id: string) {
  return (
    id.startsWith(CATALOGUE_CARD_FOCUS_ID_PREFIX) ||
    id === CATALOGUE_EMPTY_STATE_ID ||
    id === CATALOGUE_ERROR_STATE_ID
  );
}

export function getCatalogueFilterCheckboxFocusId(key: string, value: string) {
  return `catalogue-filter-checkbox:${key}:${value}`;
}

export function getCatalogueActiveFilterChipFocusId(
  key: string,
  value: string | number
) {
  return `catalogue-filter-chip:${key}:${value}`;
}
