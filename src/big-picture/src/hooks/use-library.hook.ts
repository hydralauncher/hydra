import { useCallback, useEffect, useState } from "react";
import { IS_DESKTOP } from "../constants";
import type { LibraryGame } from "@types";

export function useLibrary() {
  const [library, setLibrary] = useState<LibraryGame[]>([]);

  const updateLibrary = useCallback(async () => {
    if (!IS_DESKTOP) return;
    const updatedLibrary = await globalThis.window.electron.getLibrary();
    setLibrary(updatedLibrary);
  }, []);

  useEffect(() => {
    updateLibrary();

    if (!IS_DESKTOP) return;

    const unsubscribe = window.electron.onLibraryBatchComplete(() => {
      void updateLibrary();
    });

    return () => {
      unsubscribe();
    };
  }, [updateLibrary]);

  return { library, updateLibrary };
}
