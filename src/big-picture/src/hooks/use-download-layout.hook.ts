import type { DownloadLayoutState } from "@types";
import { DEFAULT_DOWNLOAD_LAYOUT_STATE } from "../../../types";
import { useCallback, useEffect, useState } from "react";
import { IS_DESKTOP } from "../constants";

export function useDownloadLayout() {
  const [layoutState, setLayoutState] = useState<DownloadLayoutState>(
    DEFAULT_DOWNLOAD_LAYOUT_STATE
  );

  const updateLayoutState = useCallback(async () => {
    if (!IS_DESKTOP) return DEFAULT_DOWNLOAD_LAYOUT_STATE;

    const nextLayoutState =
      await globalThis.window.electron.getDownloadLayoutState();
    setLayoutState(nextLayoutState);
    return nextLayoutState;
  }, []);

  useEffect(() => {
    updateLayoutState();

    if (!IS_DESKTOP) return;

    const unsubscribeDownloadsUpdated =
      globalThis.window.electron.onDownloadsUpdated(() => {
        updateLayoutState();
      });

    return () => {
      unsubscribeDownloadsUpdated();
    };
  }, [updateLayoutState]);

  return { layoutState, updateLayoutState };
}
