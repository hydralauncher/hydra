export const CATALOGUE_PAGE_REGION_ID = "catalogue-page";
export const CATALOGUE_HEADER_CONTROLS_REGION_ID = "catalogue-header-controls";
export const CATALOGUE_GRID_REGION_ID = "catalogue-grid";
export const CATALOGUE_PAGINATION_REGION_ID = "catalogue-pagination";
export const CATALOGUE_FILTERS_REGION_ID = "catalogue-filters";
export const CATALOGUE_EMPTY_STATE_ID = "catalogue-empty-state";
export const CATALOGUE_ERROR_STATE_ID = "catalogue-error-state";
export const CATALOGUE_SORT_SELECT_ID = "catalogue-sort-select";
export const CATALOGUE_CLEAR_FILTERS_ID = "catalogue-clear-filters";
export const CATALOGUE_PAGINATION_FIRST_ID = "catalogue-pagination:first";
export const CATALOGUE_PAGINATION_PREVIOUS_ID = "catalogue-pagination:previous";
export const CATALOGUE_PAGINATION_JUMP_ID = "catalogue-pagination:jump";
export const CATALOGUE_PAGINATION_NEXT_ID = "catalogue-pagination:next";
export const CATALOGUE_PAGINATION_LAST_ID = "catalogue-pagination:last";
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

export function getCatalogueFilterInputFocusId(key: string) {
  return `catalogue-filter-input:${key}`;
}

export function getCatalogueFilterHeaderFocusId(key: string) {
  return `catalogue-filter-header:${key}`;
}

export function getCatalogueFilterRegionId(key: string) {
  return `catalogue-filter-region:${key}`;
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

export function getCataloguePaginationPageFocusId(page: number) {
  return `catalogue-pagination:page:${page}`;
}
