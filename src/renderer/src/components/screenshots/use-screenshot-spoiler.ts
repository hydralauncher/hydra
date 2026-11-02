import { useCallback, useSyncExternalStore } from "react";

import {
  isScreenshotSpoilerHidden,
  revealScreenshotSpoiler,
  subscribeScreenshotSpoilerReveals,
} from "@shared";
import type { ProfileScreenshot } from "@types";

export function useScreenshotSpoiler(
  screenshot: Pick<ProfileScreenshot, "id" | "isSpoiler"> | null
) {
  const screenshotId = screenshot?.id ?? null;
  const isSpoiler = screenshot?.isSpoiler ?? false;

  const isHidden = useSyncExternalStore(
    subscribeScreenshotSpoilerReveals,
    () =>
      screenshotId
        ? isScreenshotSpoilerHidden({ id: screenshotId, isSpoiler })
        : false
  );

  const reveal = useCallback(() => {
    if (screenshotId) revealScreenshotSpoiler(screenshotId);
  }, [screenshotId]);

  return { isHidden, reveal };
}
