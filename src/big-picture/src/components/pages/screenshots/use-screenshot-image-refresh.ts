import { useCallback, useRef } from "react";
import type { ProfileScreenshot } from "@types";
import {
  buildUserScreenshotPath,
  createScreenshotImageRefresher,
  type ScreenshotImageRefresher,
  type ScreenshotPatch,
} from "@shared";
import { logger } from "@renderer/logger";

export type RefreshScreenshotImage = (
  screenshot: ProfileScreenshot
) => Promise<void>;

export function useScreenshotImageRefresh(
  needsAuth: boolean,
  applyPatch: (screenshotId: string, patch: ScreenshotPatch) => void,
  sharedRefresher?: ScreenshotImageRefresher
) {
  const ownRefresherRef = useRef<ScreenshotImageRefresher | null>(null);
  ownRefresherRef.current ??= createScreenshotImageRefresher();
  const refresher = sharedRefresher ?? ownRefresherRef.current;
  const needsAuthRef = useRef(needsAuth);
  needsAuthRef.current = needsAuth;
  const applyPatchRef = useRef(applyPatch);
  applyPatchRef.current = applyPatch;

  return useCallback<RefreshScreenshotImage>(
    (screenshot) =>
      refresher.run(screenshot.id, async () => {
        try {
          const fresh =
            await globalThis.window.electron.hydraApi.get<ProfileScreenshot | null>(
              buildUserScreenshotPath(screenshot.owner.id, screenshot.id),
              { needsAuth: needsAuthRef.current }
            );
          if (!fresh) return;

          applyPatchRef.current(screenshot.id, {
            imageUrl: fresh.imageUrl,
            thumbnailUrl: fresh.thumbnailUrl,
          });
        } catch (error) {
          logger.warn("Failed to refresh the screenshot image", error);
        }
      }),
    [refresher]
  );
}
