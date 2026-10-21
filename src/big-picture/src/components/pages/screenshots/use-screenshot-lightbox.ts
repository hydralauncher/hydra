import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProfileScreenshot } from "@types";
import {
  applyScreenshotPatch,
  buildUserScreenshotPath,
  getScreenshotApiErrorCode,
  type ScreenshotPatch,
} from "@shared";
import { logger } from "@renderer/logger";

import { pickNewerScreenshot } from "./helpers";

import type {
  ScreenshotLightboxProps,
  ScreenshotLightboxStatus,
} from "./screenshot-lightbox";

interface UseScreenshotLightboxOptions {
  items: ProfileScreenshot[];
  needsAuth: boolean;
  updateItem: (screenshotId: string, update: ScreenshotPatch) => void;
  removeItem: (screenshotId: string, ownerId: string) => void;
  getFetchedAt: (screenshotId: string) => number | null;
}

interface LightboxState {
  screenshotId: string | null;
  status: ScreenshotLightboxStatus;
}

interface StandaloneScreenshot {
  screenshot: ProfileScreenshot;
  fetchedAt: number | null;
}

export function useScreenshotLightbox({
  items,
  needsAuth,
  updateItem,
  removeItem,
  getFetchedAt,
}: UseScreenshotLightboxOptions) {
  const [state, setState] = useState<LightboxState | null>(null);
  const [standalone, setStandalone] = useState<StandaloneScreenshot | null>(
    null
  );
  const requestRef = useRef(0);

  const index = state?.screenshotId
    ? items.findIndex((item) => item.id === state.screenshotId)
    : -1;
  const listItem = items[index] ?? null;
  const detached =
    standalone?.screenshot.id === state?.screenshotId ? standalone : null;
  const screenshot = pickNewerScreenshot(
    listItem,
    listItem ? getFetchedAt(listItem.id) : null,
    detached?.screenshot ?? null,
    detached?.fetchedAt ?? null
  );

  const open = useCallback(
    (target: ProfileScreenshot) => {
      requestRef.current += 1;
      setStandalone({ screenshot: target, fetchedAt: getFetchedAt(target.id) });
      setState({ screenshotId: target.id, status: "ready" });
    },
    [getFetchedAt]
  );

  const openById = useCallback(
    async (ownerId: string, screenshotId: string) => {
      const existing = items.find((item) => item.id === screenshotId);
      if (existing) {
        open(existing);
        return;
      }

      const request = requestRef.current + 1;
      requestRef.current = request;
      const startedAt = performance.now();
      setState({ screenshotId, status: "loading" });

      try {
        const response =
          await globalThis.window.electron.hydraApi.get<ProfileScreenshot>(
            buildUserScreenshotPath(ownerId, screenshotId),
            { needsAuth }
          );

        if (requestRef.current !== request) return;

        if (!response) {
          setState({ screenshotId, status: "unavailable" });
          return;
        }

        setStandalone({ screenshot: response, fetchedAt: startedAt });
        setState({ screenshotId: response.id, status: "ready" });
      } catch (error) {
        if (requestRef.current !== request) return;

        const code = getScreenshotApiErrorCode(error);
        if (code !== "screenshots/private" && code !== "screenshots/not-found")
          logger.error("Failed to open screenshot", error);

        setState({
          screenshotId,
          status: code === "screenshots/private" ? "private" : "unavailable",
        });
      }
    },
    [items, needsAuth, open]
  );

  const close = useCallback(() => {
    requestRef.current += 1;
    setState(null);
    setStandalone(null);
  }, []);

  useEffect(() => {
    if (state?.status === "ready" && !screenshot) close();
  }, [close, screenshot, state?.status]);

  const update = useCallback(
    (screenshotId: string, patch: ScreenshotPatch) => {
      updateItem(screenshotId, patch);
      setStandalone((current) =>
        current?.screenshot.id === screenshotId
          ? {
              ...current,
              screenshot: applyScreenshotPatch(current.screenshot, patch),
            }
          : current
      );
    },
    [updateItem]
  );

  const remove = useCallback(
    (screenshotId: string, ownerId: string) => {
      removeItem(screenshotId, ownerId);
      setStandalone((current) =>
        current?.screenshot.id === screenshotId ? null : current
      );
    },
    [removeItem]
  );

  const markUnavailable = useCallback(
    (screenshotId: string, ownerId: string) => {
      removeItem(screenshotId, ownerId);
      setStandalone((current) =>
        current?.screenshot.id === screenshotId ? null : current
      );
      setState({ screenshotId, status: "unavailable" });
    },
    [removeItem]
  );

  const hasPrevious = index > 0;
  const hasNext = index >= 0 && index < items.length - 1;

  const lightboxProps = useMemo<ScreenshotLightboxProps>(
    () => ({
      status: state ? state.status : null,
      screenshot: state?.status === "ready" ? screenshot : null,
      hasPrevious,
      hasNext,
      onPrevious: () => {
        const previous = items[index - 1];
        if (previous) open(previous);
      },
      onNext: () => {
        const next = items[index + 1];
        if (next) open(next);
      },
      onClose: close,
      onUpdate: update,
      onRemove: remove,
      onUnavailable: markUnavailable,
    }),
    [
      close,
      hasNext,
      hasPrevious,
      index,
      items,
      markUnavailable,
      open,
      remove,
      screenshot,
      state,
      update,
    ]
  );

  return { open, openById, close, lightboxProps };
}
