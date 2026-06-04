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

    const unsubscribeLibraryBatch =
      globalThis.window.electron.onLibraryBatchComplete(() => {
        updateLibrary();
      });

    const unsubscribeDownloadsUpdated =
      globalThis.window.electron.onDownloadsUpdated(() => {
        updateLibrary();
      });

    const handleLibraryUpdate = () => updateLibrary();
    globalThis.window.addEventListener("library-update", handleLibraryUpdate);

    return () => {
      unsubscribeLibraryBatch();
      unsubscribeDownloadsUpdated();
      globalThis.window.removeEventListener(
        "library-update",
        handleLibraryUpdate
      );
    };
  }, [updateLibrary]);

  return { library, updateLibrary };
}
