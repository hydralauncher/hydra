export const CATALOGUE_PAGE_REGION_ID = "catalogue-page";
export const CATALOGUE_HEADER_CONTROLS_REGION_ID = "catalogue-header-controls";
export const CATALOGUE_GRID_REGION_ID = "catalogue-grid";
export const CATALOGUE_PAGINATION_REGION_ID = "catalogue-pagination";
export const CATALOGUE_EMPTY_STATE_ID = "catalogue-empty-state";
export const CATALOGUE_ERROR_STATE_ID = "catalogue-error-state";
export const CATALOGUE_FILTERS_BUTTON_ID = "catalogue-filters-button";
export const CATALOGUE_SORT_SELECT_ID = "catalogue-sort-select";
export const CATALOGUE_CLEAR_FILTERS_ID = "catalogue-clear-filters";
export const CATALOGUE_HIDDEN_FILTERS_BUTTON_ID =
  "catalogue-hidden-filters-button";
export const CATALOGUE_MODE_MODERN_ID = "catalogue-mode-modern";
export const CATALOGUE_MODE_CLASSICS_ID = "catalogue-mode-classics";
export const CATALOGUE_PAGINATION_FIRST_ID = "catalogue-pagination:first";
export const CATALOGUE_PAGINATION_PREVIOUS_ID = "catalogue-pagination:previous";
export const CATALOGUE_PAGINATION_NEXT_ID = "catalogue-pagination:next";
export const CATALOGUE_PAGINATION_LAST_ID = "catalogue-pagination:last";
const CATALOGUE_CARD_FOCUS_ID_PREFIX = "catalogue-card:";
const CATALOGUE_FILTER_CHIP_FOCUS_ID_PREFIX = "catalogue-filter-chip:";

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
  return `${CATALOGUE_FILTER_CHIP_FOCUS_ID_PREFIX}${key}:${value}`;
}

export function isCatalogueActiveFilterChipFocusId(id: string) {
  return id.startsWith(CATALOGUE_FILTER_CHIP_FOCUS_ID_PREFIX);
}

export function getCataloguePaginationPageFocusId(page: number) {
  return `catalogue-pagination:page:${page}`;
}
