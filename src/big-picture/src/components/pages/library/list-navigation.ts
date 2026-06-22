import type { LibraryGame } from "@types";
import {
  getLibraryFocusListItemId,
  LIBRARY_FOCUS_LIST_REGION_ID,
} from "./navigation";
import { useMeasuredRowNavigation } from "./measured-row-navigation";

export function useLibraryListNavigation(games: LibraryGame[]) {
  return useMeasuredRowNavigation({
    games,
    getItemId: getLibraryFocusListItemId,
    regionId: LIBRARY_FOCUS_LIST_REGION_ID,
  });
}
