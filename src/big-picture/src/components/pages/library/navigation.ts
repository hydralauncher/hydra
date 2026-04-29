export const LIBRARY_HERO_ACTIONS_REGION_ID = "library-hero-actions";
export const LIBRARY_HERO_LAUNCH_BUTTON_ID = "library-hero-launch-button";
export const LIBRARY_HERO_OPTIONS_BUTTON_ID = "library-hero-options-button";
export const LIBRARY_HERO_FAVORITE_BUTTON_ID = "library-hero-favorite-button";
export const LIBRARY_FILTERS_TOOLBAR_REGION_ID = "library-filters-toolbar";
export const LIBRARY_FILTERS_TABS_REGION_ID = "library-filters-tabs";
export const LIBRARY_FILTERS_SEARCH_INPUT_ID = "library-filters-search-input";
export const LIBRARY_FILTERS_LIST_VIEW_BUTTON_ID =
  "library-filters-list-view-button";
export const LIBRARY_FILTERS_GRID_VIEW_BUTTON_ID =
  "library-filters-grid-view-button";
export const LIBRARY_FILTERS_ALL_TAB_ID = "library-filters-tab-all";
export const LIBRARY_FILTERS_FAVORITES_TAB_ID = "library-filters-tab-favorites";
export const LIBRARY_FILTERS_COMPLETED_TAB_ID = "library-filters-tab-completed";
export const LIBRARY_FOCUS_GRID_REGION_ID = "library-focus-grid";
export const LIBRARY_FOCUS_LIST_REGION_ID = "library-focus-list";

export function getLibraryFocusGridItemId(gameId: string) {
  return `library-focus-grid-item-${gameId}`;
}

export function getFirstLibraryFocusGridItemId(gameId?: string | null) {
  if (!gameId) return null;

  return getLibraryFocusGridItemId(gameId);
}

export function getLibraryFocusListItemId(gameId: string) {
  return `library-focus-list-item-${gameId}`;
}

export function getFirstLibraryFocusListItemId(gameId?: string | null) {
  if (!gameId) return null;

  return getLibraryFocusListItemId(gameId);
}
