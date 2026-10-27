import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import { useAppSelector } from "@renderer/hooks";
import {
  isSensitiveScreenshotHidden,
  resolveScreenshotPreferences,
  revealSensitiveScreenshot,
  subscribeSensitiveScreenshotReveals,
} from "@shared";
import type { ProfileScreenshot } from "@types";

type SensitiveScreenshotTarget = Pick<
  ProfileScreenshot,
  "id" | "isSensitive" | "owner"
>;

export function useSensitiveScreenshot(
  screenshot: SensitiveScreenshotTarget | null
) {
  const viewerId = useAppSelector(
    (state) => state.userDetails.userDetails?.id ?? null
  );
  const showSensitive = useAppSelector(
    (state) =>
      resolveScreenshotPreferences(state.userPreferences.value).showSensitive
  );
  const screenshotId = screenshot?.id ?? null;

  const isHidden = useSyncExternalStore(
    subscribeSensitiveScreenshotReveals,
    () =>
      screenshot
        ? isSensitiveScreenshotHidden(screenshot, { viewerId, showSensitive })
        : false
  );

  const reveal = useCallback(() => {
    if (screenshotId) revealSensitiveScreenshot(screenshotId);
  }, [screenshotId]);

  return { isHidden, reveal };
}

export function useSensitiveScreenshotConfirmation(
  screenshot: SensitiveScreenshotTarget | null
) {
  const { isHidden, reveal } = useSensitiveScreenshot(screenshot);
  const [isConfirming, setIsConfirming] = useState(false);
  const onRevealedRef = useRef<(() => void) | null>(null);

  const requestReveal = useCallback((onRevealed?: () => void) => {
    onRevealedRef.current = onRevealed ?? null;
    setIsConfirming(true);
  }, []);

  const handleConfirm = useCallback(() => {
    const onRevealed = onRevealedRef.current;
    onRevealedRef.current = null;
    reveal();
    setIsConfirming(false);
    onRevealed?.();
  }, [reveal]);

  const handleClose = useCallback(() => {
    onRevealedRef.current = null;
    setIsConfirming(false);
  }, []);

  return {
    isHidden,
    requestReveal,
    modalProps: {
      visible: isConfirming,
      onConfirm: handleConfirm,
      onClose: handleClose,
    },
  };
}
