import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot, ScreenshotLikeResponse } from "@types";
import {
  AuthPage,
  buildUserScreenshotLikePath,
  getScreenshotApiErrorCode,
  type ScreenshotPatch,
} from "@shared";
import { logger } from "@renderer/logger";

import { useBigPictureToast, useUserDetails } from "../../../hooks";
import { getLikePatch, getScreenshotErrorKey } from "./helpers";

export function useScreenshotCardLike(
  updateItem: (screenshotId: string, update: ScreenshotPatch) => void,
  removeItem: (screenshotId: string, ownerId: string) => void
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
        const response = likedByMe
          ? await globalThis.window.electron.hydraApi.put<ScreenshotLikeResponse>(
              path,
              { needsAuth: true }
            )
          : await globalThis.window.electron.hydraApi.delete<ScreenshotLikeResponse>(
              path,
              { needsAuth: true }
            );
        if (response) updateItem(screenshot.id, getLikePatch(response));
      } catch (error) {
        logger.error("Failed to update screenshot like", error);
        const code = getScreenshotApiErrorCode(error);
        if (code === "screenshots/not-found") {
          removeItem(screenshot.id, screenshot.owner.id);
        } else {
          updateItem(screenshot.id, previous);
        }
        showErrorToast(t(getScreenshotErrorKey(code)), {
          fallbackVisual: "settings",
        });
      } finally {
        setLiking(screenshot.id, false);
      }
    },
    [isSignedIn, removeItem, setLiking, showErrorToast, t, updateItem]
  );

  return { likingIds, toggleLike };
}
