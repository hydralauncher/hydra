import { useEffect, useState } from "react";
import type { ScreenshotInputStatus } from "@types";

import { logger } from "@renderer/logger";

export function useScreenshotInputStatus(): ScreenshotInputStatus | null {
  const [status, setStatus] = useState<ScreenshotInputStatus | null>(null);

  useEffect(() => {
    let active = true;

    window.electron
      .getScreenshotInputStatus()
      .then((nextStatus) => {
        if (active) setStatus(nextStatus);
      })
      .catch((error) => {
        logger.error("Failed to read the screenshot input status", error);
      });

    const unsubscribe = window.electron.onScreenshotInputStatusChange(
      (nextStatus) => setStatus(nextStatus)
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return status;
}
