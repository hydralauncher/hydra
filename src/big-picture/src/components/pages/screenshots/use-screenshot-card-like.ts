import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot } from "@types";
import {
  AuthPage,
  buildUserScreenshotLikePath,
  getScreenshotApiErrorCode,
  type ScreenshotPatch,
} from "@shared";
import { logger } from "@renderer/logger";

import { useBigPictureToast, useUserDetails } from "../../../hooks";
import { getScreenshotErrorKey } from "./helpers";

export function useScreenshotCardLike(
  updateItem: (screenshotId: string, update: ScreenshotPatch) => void
) {
  const { t } = useTranslation("big_picture");
  const { showErrorToast } = useBigPictureToast();
  const { userDetails } = useUserDetails();
  const isSignedIn = Boolean(userDetails);
  const [likingIds, setLikingIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const likingIdsRef = useRef(new Set<string>());

  const setLiking = useCallback((screenshotId: string, isLiking: boolean) => {
    if (isLiking) likingIdsRef.current.add(screenshotId);
    else likingIdsRef.current.delete(screenshotId);
    setLikingIds(new Set(likingIdsRef.current));
  }, []);

  const toggleLike = useCallback(
    async (screenshot: ProfileScreenshot) => {
      if (!isSignedIn) {
        void globalThis.window.electron.openAuthWindow(AuthPage.SignIn);
        return;
      }
      if (likingIdsRef.current.has(screenshot.id)) return;

      const previous = {
        likeCount: screenshot.likeCount,
        likedByMe: screenshot.likedByMe,
      };
      const likedByMe = !screenshot.likedByMe;
      const path = buildUserScreenshotLikePath(
        screenshot.owner.id,
        screenshot.id
      );

      setLiking(screenshot.id, true);
      updateItem(screenshot.id, {
        likedByMe,
        likeCount: Math.max(0, screenshot.likeCount + (likedByMe ? 1 : -1)),
      });

      try {
        if (likedByMe) {
          await globalThis.window.electron.hydraApi.put(path, {
            needsAuth: true,
          });
        } else {
          await globalThis.window.electron.hydraApi.delete(path, {
            needsAuth: true,
          });
        }
      } catch (error) {
        logger.error("Failed to update screenshot like", error);
        updateItem(screenshot.id, previous);
        showErrorToast(
          t(getScreenshotErrorKey(getScreenshotApiErrorCode(error))),
          { fallbackVisual: "settings" }
        );
      } finally {
        setLiking(screenshot.id, false);
      }
    },
    [isSignedIn, setLiking, showErrorToast, t, updateItem]
  );

  return { likingIds, toggleLike };
}
