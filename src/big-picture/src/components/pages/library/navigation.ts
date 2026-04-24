export const LIBRARY_HERO_ACTIONS_REGION_ID = "library-hero-actions";
export const LIBRARY_FOCUS_GRID_REGION_ID = "library-focus-grid";

export function getLibraryFocusGridItemId(gameId: string) {
  return `library-focus-grid-item-${gameId}`;
}

export function getFirstLibraryFocusGridItemId(gameId?: string | null) {
  if (!gameId) return null;

  return getLibraryFocusGridItemId(gameId);
}
