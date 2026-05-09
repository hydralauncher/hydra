import type { DownloadLayoutState } from "@types";
import { DEFAULT_DOWNLOAD_LAYOUT_STATE } from "../../../types";
import { useCallback, useEffect, useState } from "react";

export function useDownloadLayout() {
  const [layoutState, setLayoutState] = useState<DownloadLayoutState>(
    DEFAULT_DOWNLOAD_LAYOUT_STATE
  );

  const updateLayoutState = useCallback(async () => {
    const nextLayoutState = await window.electron.getDownloadLayoutState();
    setLayoutState(nextLayoutState);
    return nextLayoutState;
  }, []);

  useEffect(() => {
    updateLayoutState();

    const unsubscribeDownloadsUpdated = window.electron.onDownloadsUpdated(
      () => {
        updateLayoutState();
      }
    );

    return () => {
      unsubscribeDownloadsUpdated();
    };
  }, [updateLayoutState]);

  return { layoutState, updateLayoutState };
}
