import type { GameShop, LibraryGame } from "@types";
import { useMemo } from "react";
import { getLibraryGameState, type LibraryGameState } from "../helpers";
import { useLibrary } from "./use-library.hook";

const emptyLibraryState: LibraryGameState = {
  libraryGame: null,
  isInLibrary: false,
  hasExecutable: false,
};

export type UseLibraryGameStateResult = LibraryGameState & {
  library: LibraryGame[];
  updateLibrary: () => Promise<void>;
};

export function useLibraryGameState(
  shop: GameShop | null | undefined,
  objectId: string | null | undefined
): UseLibraryGameStateResult {
  const { library, updateLibrary } = useLibrary();
  const state = useMemo((): LibraryGameState => {
    if (shop == null || objectId == null) {
      return emptyLibraryState;
    }
    return getLibraryGameState(library, shop, objectId);
  }, [library, shop, objectId]);

  return {
    ...state,
    library,
    updateLibrary,
  };
}
