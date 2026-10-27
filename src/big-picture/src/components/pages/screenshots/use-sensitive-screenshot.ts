import { useCallback, useSyncExternalStore } from "react";
import type { ProfileScreenshot } from "@types";
import {
  isSensitiveScreenshotHidden,
  resolveScreenshotPreferences,
  revealSensitiveScreenshot,
  subscribeSensitiveScreenshotReveals,
  type SensitiveScreenshotViewer,
} from "@shared";

import { useUserDetails, useUserPreferences } from "../../../hooks";

export type SensitiveScreenshotTarget = Pick<
  ProfileScreenshot,
  "id" | "isSensitive" | "isSpoiler" | "owner"
>;

let sensitiveRevealVersion = 0;

subscribeSensitiveScreenshotReveals(() => {
  sensitiveRevealVersion += 1;
});

const getSensitiveRevealVersion = () => sensitiveRevealVersion;

export function useSensitiveScreenshotViewer() {
  const { userDetails } = useUserDetails();
  const userPreferences = useUserPreferences();
  useSyncExternalStore(
    subscribeSensitiveScreenshotReveals,
    getSensitiveRevealVersion
  );

  const viewer: SensitiveScreenshotViewer = {
    viewerId: userDetails?.id ?? null,
    showSensitive: resolveScreenshotPreferences(userPreferences).showSensitive,
  };

  return {
    isHidden: (screenshot: SensitiveScreenshotTarget) =>
      isSensitiveScreenshotHidden(screenshot, viewer),
    reveal: revealSensitiveScreenshot,
  };
}

export function useSensitiveScreenshot(
  screenshot: SensitiveScreenshotTarget | null
) {
  const { isHidden } = useSensitiveScreenshotViewer();
  const screenshotId = screenshot?.id ?? null;

  const reveal = useCallback(() => {
    if (screenshotId) revealSensitiveScreenshot(screenshotId);
  }, [screenshotId]);

  return {
    isHidden: screenshot ? isHidden(screenshot) : false,
    reveal,
  };
}
