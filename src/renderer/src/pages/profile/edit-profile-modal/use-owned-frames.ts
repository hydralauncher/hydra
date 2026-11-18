import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { OwnedFramesResponse } from "@types";

const EMPTY: OwnedFramesResponse = { equippedFrameKey: null, frames: [] };

/** The frames the user owns, fetched each time the modal opens. */
export function useOwnedFrames(isEnabled: boolean) {
  const { i18n } = useTranslation();
  const [owned, setOwned] = useState<OwnedFramesResponse>(EMPTY);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!isEnabled) return;

    let isCancelled = false;
    setIsLoading(true);
    window.electron.hydraApi
      .get<OwnedFramesResponse>("/profile/frames", {
        params: { locale: i18n.language },
      })
      .then((response) => {
        if (!isCancelled) setOwned(response);
      })
      .catch(() => {
        if (!isCancelled) setOwned(EMPTY);
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [isEnabled, i18n.language]);

  return { ...owned, isLoading };
}
