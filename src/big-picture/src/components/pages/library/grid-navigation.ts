import type { LibraryGame } from "@types";
import {
  getLibraryFocusGridItemId,
  LIBRARY_FOCUS_GRID_REGION_ID,
} from "./navigation";
import { useMeasuredRowNavigation } from "./measured-row-navigation";

export function useLibraryGridNavigation(games: LibraryGame[]) {
  return useMeasuredRowNavigation({
    games,
    getItemId: getLibraryFocusGridItemId,
    regionId: LIBRARY_FOCUS_GRID_REGION_ID,
  });
}
