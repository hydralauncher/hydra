import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProfileScreenshot } from "@types";
import { buildUserScreenshotPath, getScreenshotErrorCode } from "@shared";
import { logger } from "@renderer/logger";

import type {
  ScreenshotLightboxProps,
  ScreenshotLightboxStatus,
} from "./screenshot-lightbox";

interface UseScreenshotLightboxOptions {
  items: ProfileScreenshot[];
  needsAuth: boolean;
  updateItem: (
    screenshotId: string,
    update: Partial<ProfileScreenshot>
  ) => void;
  removeItem: (screenshotId: string) => void;
}

interface LightboxState {
  screenshotId: string | null;
  status: ScreenshotLightboxStatus;
}

function resolveOpenScreenshot(
  listItem: ProfileScreenshot | undefined,
  standalone: ProfileScreenshot | null,
  screenshotId: string | null
) {
  if (listItem) return listItem;
  if (standalone && standalone.id === screenshotId) return standalone;

  return null;
}

export function useScreenshotLightbox({
  items,
  needsAuth,
  updateItem,
  removeItem,
}: UseScreenshotLightboxOptions) {
  const [state, setState] = useState<LightboxState | null>(null);
  const [standalone, setStandalone] = useState<ProfileScreenshot | null>(null);
  const requestRef = useRef(0);

  const index = state?.screenshotId
    ? items.findIndex((item) => item.id === state.screenshotId)
    : -1;
  const screenshot = resolveOpenScreenshot(
    items[index],
    standalone,
    state?.screenshotId ?? null
  );

  const open = useCallback((target: ProfileScreenshot) => {
    requestRef.current += 1;
    setStandalone(target);
    setState({ screenshotId: target.id, status: "ready" });
  }, []);

  const openById = useCallback(
    async (ownerId: string, screenshotId: string) => {
      const existing = items.find((item) => item.id === screenshotId);
      if (existing) {
        open(existing);
        return;
      }

      const request = requestRef.current + 1;
      requestRef.current = request;
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

        setStandalone(response);
        setState({ screenshotId: response.id, status: "ready" });
      } catch (error) {
        if (requestRef.current !== request) return;

        const code = getScreenshotErrorCode(error);
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
    (screenshotId: string, patch: Partial<ProfileScreenshot>) => {
      updateItem(screenshotId, patch);
      setStandalone((current) =>
        current && current.id === screenshotId
          ? { ...current, ...patch }
          : current
      );
    },
    [updateItem]
  );

  const remove = useCallback(
    (screenshotId: string) => {
      removeItem(screenshotId);
      setStandalone((current) =>
        current && current.id === screenshotId ? null : current
      );
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
    }),
    [
      close,
      hasNext,
      hasPrevious,
      index,
      items,
      open,
      remove,
      screenshot,
      state,
      update,
    ]
  );

  return { open, openById, close, lightboxProps };
}
