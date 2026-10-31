import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProfileScreenshot } from "@types";
import {
  applyScreenshotPatch,
  buildUserScreenshotPath,
  getScreenshotApiErrorCode,
  type ScreenshotImageRefresher,
  type ScreenshotPatch,
} from "@shared";
import { logger } from "@renderer/logger";

import { pickNewerScreenshot } from "./helpers";
import { useScreenshotImageRefresh } from "./use-screenshot-image-refresh";
import type { RemoteScreenshotWriteListener } from "./use-screenshot-feed";

import type {
  ScreenshotLightboxProps,
  ScreenshotLightboxStatus,
} from "./screenshot-lightbox";

interface UseScreenshotLightboxOptions {
  items: ProfileScreenshot[];
  needsAuth: boolean;
  updateItem: (screenshotId: string, update: ScreenshotPatch) => void;
  removeItem: (screenshotId: string, ownerId: string) => void;
  removeDeletedItem?: (screenshotId: string, ownerId: string) => void;
  getFetchedAt: (screenshotId: string) => number | null;
  imageRefresher?: ScreenshotImageRefresher;
  subscribeRemoteWrites?: (
    listener: RemoteScreenshotWriteListener
  ) => () => void;
  hasMore?: boolean;
  loadMore?: () => Promise<boolean>;
  hasLoadMoreError?: boolean;
  retryLoadMore?: () => void;
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
  removeDeletedItem = removeItem,
  getFetchedAt,
  imageRefresher,
  subscribeRemoteWrites,
  hasMore = false,
  loadMore,
  hasLoadMoreError = false,
  retryLoadMore,
}: UseScreenshotLightboxOptions) {
  const [state, setState] = useState<LightboxState | null>(null);
  const [pendingNextAfterId, setPendingNextAfterId] = useState<string | null>(
    null
  );
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
      setPendingNextAfterId(null);
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
    setPendingNextAfterId(null);
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

  useEffect(() => {
    if (!subscribeRemoteWrites) return;

    return subscribeRemoteWrites(({ screenshotId, patch }) => {
      if (patch === null) {
        setStandalone((current) =>
          current?.screenshot.id === screenshotId ? null : current
        );
        setState((current) =>
          current?.screenshotId === screenshotId
            ? { screenshotId, status: "unavailable" }
            : current
        );
        return;
      }

      setStandalone((current) =>
        current?.screenshot.id === screenshotId
          ? {
              ...current,
              screenshot: applyScreenshotPatch(current.screenshot, patch),
            }
          : current
      );
    });
  }, [subscribeRemoteWrites]);

  const refreshImage = useScreenshotImageRefresh(
    needsAuth,
    update,
    imageRefresher
  );

  const remove = useCallback(
    (screenshotId: string, ownerId: string) => {
      removeDeletedItem(screenshotId, ownerId);
      setStandalone((current) =>
        current?.screenshot.id === screenshotId ? null : current
      );
    },
    [removeDeletedItem]
  );

  const markUnavailable = useCallback(
    (screenshotId: string, ownerId: string) => {
      removeItem(screenshotId, ownerId);
      setStandalone((current) =>
        current?.screenshot.id === screenshotId ? null : current
      );
      setState((current) =>
        current?.screenshotId === screenshotId
          ? { screenshotId, status: "unavailable" }
          : current
      );
    },
    [removeItem]
  );

  useEffect(() => {
    if (!pendingNextAfterId) return;

    const position = items.findIndex((item) => item.id === pendingNextAfterId);
    const next = position >= 0 ? items[position + 1] : undefined;
    if (next) open(next);
  }, [items, open, pendingNextAfterId]);

  const canLoadMoreAtEnd =
    Boolean(loadMore) && hasMore && index >= 0 && index === items.length - 1;

  const navigatePastEnd = useCallback(() => {
    if (!loadMore || !screenshot) return;

    const afterId = screenshot.id;
    setPendingNextAfterId(afterId);
    if (hasLoadMoreError) {
      retryLoadMore?.();
      return;
    }
    loadMore()
      .then((hasRequestedPage) => {
        if (hasRequestedPage) return;
        setPendingNextAfterId((current) =>
          current === afterId ? null : current
        );
      })
      .catch((error: unknown) => {
        logger.error("Failed to load more screenshots", error);
      });
  }, [hasLoadMoreError, loadMore, retryLoadMore, screenshot]);

  const lightboxProps = useMemo<ScreenshotLightboxProps>(
    () => ({
      status: state ? state.status : null,
      screenshot: state?.status === "ready" ? screenshot : null,
      items,
      canLoadMore: canLoadMoreAtEnd,
      hasLoadMoreError: canLoadMoreAtEnd && hasLoadMoreError,
      onSelect: (target: ProfileScreenshot) => open(target),
      onLoadMore: navigatePastEnd,
      onClose: close,
      onUpdate: update,
      onRemove: remove,
      onUnavailable: markUnavailable,
      onRefreshImage: refreshImage,
    }),
    [
      canLoadMoreAtEnd,
      close,
      hasLoadMoreError,
      navigatePastEnd,
      refreshImage,
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
