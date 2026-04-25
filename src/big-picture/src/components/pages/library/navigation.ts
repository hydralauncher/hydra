export const LIBRARY_HERO_ACTIONS_REGION_ID = "library-hero-actions";
export const LIBRARY_FILTERS_TOOLBAR_REGION_ID = "library-filters-toolbar";
export const LIBRARY_FILTERS_TABS_REGION_ID = "library-filters-tabs";
export const LIBRARY_FILTERS_SEARCH_INPUT_ID = "library-filters-search-input";
export const LIBRARY_FILTERS_ALL_TAB_ID = "library-filters-tab-all";
export const LIBRARY_FILTERS_FAVORITES_TAB_ID =
  "library-filters-tab-favorites";
export const LIBRARY_FILTERS_COMPLETED_TAB_ID =
  "library-filters-tab-completed";
export const LIBRARY_FOCUS_GRID_REGION_ID = "library-focus-grid";

export function getLibraryFocusGridItemId(gameId: string) {
  return `library-focus-grid-item-${gameId}`;
}

export function getFirstLibraryFocusGridItemId(gameId?: string | null) {
  if (!gameId) return null;

  return getLibraryFocusGridItemId(gameId);
}
