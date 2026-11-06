import type { LocalScreenshot } from "@types";

import { HydraApi } from "../hydra-api";

export const getSignedInScreenshotOwnerId = () =>
  HydraApi.isLoggedIn() ? (HydraApi.getAuthContext()?.userId ?? null) : null;

export const isLocalScreenshotVisibleToOwner = (
  screenshot: LocalScreenshot,
  ownerId: string | null
) => screenshot.ownerId === null || screenshot.ownerId === ownerId;

export const filterLocalScreenshotsForSignedInOwner = (
  screenshots: LocalScreenshot[]
) => {
  const ownerId = getSignedInScreenshotOwnerId();
  return screenshots.filter((screenshot) =>
    isLocalScreenshotVisibleToOwner(screenshot, ownerId)
  );
};

export const isLocalScreenshotVisibleToSignedInOwner = (
  screenshot: LocalScreenshot | null | undefined
) =>
  screenshot != null &&
  isLocalScreenshotVisibleToOwner(screenshot, getSignedInScreenshotOwnerId());
