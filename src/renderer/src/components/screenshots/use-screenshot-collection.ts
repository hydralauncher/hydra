import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import { buildUserScreenshotPath, getScreenshotApiErrorCode } from "@shared";
import type { ProfileScreenshot } from "@types";

import {
  useScreenshotActions,
  type ScreenshotFailure,
} from "./use-screenshot-actions";
import {
  useScreenshotFeed,
  type ScreenshotFeedPage,
} from "./use-screenshot-feed";

const getScreenshotFailure = (error: unknown): ScreenshotFailure | null => {
  const code = getScreenshotApiErrorCode(error);
  if (code === "screenshots/private") return "private";
  if (code === "screenshots/not-found") return "unavailable";
  return null;
};

const withoutKey = <Value>(record: Record<string, Value>, key: string) => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

export type ScreenshotLightboxStatus =
  | "closed"
  | "loading"
  | "ready"
  | ScreenshotFailure;

interface UseScreenshotCollectionOptions {
  feedKey: string | null;
  fetchPage: (cursor: string | null) => Promise<ScreenshotFeedPage | null>;
}

interface OpenTarget {
  screenshotId: string;
  ownerId: string | null;
}

export function useScreenshotCollection({
  feedKey,
  fetchPage,
}: UseScreenshotCollectionOptions) {
  const { userDetails } = useUserDetails();
  const feed = useScreenshotFeed({ feedKey, fetchPage });
  const { patchItem, removeItem } = feed;
  const [openTarget, setOpenTarget] = useState<OpenTarget | null>(null);
  const [detachedById, setDetachedById] = useState<
    Record<string, ProfileScreenshot>
  >({});
  const [failures, setFailures] = useState<Record<string, ScreenshotFailure>>(
    {}
  );
  const [loadingIds, setLoadingIds] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const fetchedIdsRef = useRef(new Set<string>());
  const requestTokensRef = useRef(new Map<string, number>());
  const refreshedIdsRef = useRef(new Set<string>());

  const openId = openTarget?.screenshotId ?? null;
  const listItem = useMemo(
    () => feed.items.find((item) => item.id === openId) ?? null,
    [feed.items, openId]
  );
  const detached = openId ? (detachedById[openId] ?? null) : null;
  const screenshot = listItem ?? detached;
  const failure = openId ? (failures[openId] ?? null) : null;

  const markFailure = useCallback(
    (screenshotId: string, nextFailure: ScreenshotFailure) => {
      setFailures((current) => ({ ...current, [screenshotId]: nextFailure }));
    },
    []
  );

  const onPatch = useCallback(
    (screenshotId: string, patch: Partial<ProfileScreenshot>) => {
      patchItem(screenshotId, patch);
      setDetachedById((current) =>
        screenshotId in current
          ? {
              ...current,
              [screenshotId]: { ...current[screenshotId], ...patch },
            }
          : current
      );
    },
    [patchItem]
  );

  const onRemove = useCallback(
    (screenshotId: string) => {
      fetchedIdsRef.current.add(screenshotId);
      removeItem(screenshotId);
      setDetachedById((current) => withoutKey(current, screenshotId));
    },
    [removeItem]
  );

  const actions = useScreenshotActions({
    onPatch,
    onRemove,
    onFailure: markFailure,
  });

  const fetchScreenshot = useCallback(
    async (ownerId: string, screenshotId: string) => {
      return window.electron.hydraApi.get<ProfileScreenshot>(
        buildUserScreenshotPath(ownerId, screenshotId),
        { needsAuth: Boolean(userDetails) }
      );
    },
    [userDetails]
  );

  useEffect(() => {
    if (!openTarget?.ownerId || listItem || detached || failure) return;
    if (fetchedIdsRef.current.has(openTarget.screenshotId)) return;

    const { ownerId, screenshotId } = openTarget;
    const token = (requestTokensRef.current.get(screenshotId) ?? 0) + 1;
    const isCurrentRequest = () =>
      requestTokensRef.current.get(screenshotId) === token;

    requestTokensRef.current.set(screenshotId, token);
    fetchedIdsRef.current.add(screenshotId);
    setLoadingIds((current) => new Set(current).add(screenshotId));

    fetchScreenshot(ownerId, screenshotId)
      .then((item) => {
        if (!isCurrentRequest()) return;
        if (item) {
          setDetachedById((current) => ({ ...current, [screenshotId]: item }));
        } else {
          markFailure(screenshotId, "unavailable");
        }
      })
      .catch((error) => {
        if (!isCurrentRequest()) return;
        logger.error("Failed to load screenshot", error);
        markFailure(screenshotId, getScreenshotFailure(error) ?? "unavailable");
      })
      .finally(() => {
        if (!isCurrentRequest()) return;
        setLoadingIds((current) => {
          const next = new Set(current);
          next.delete(screenshotId);
          return next;
        });
      });
  }, [detached, failure, fetchScreenshot, listItem, markFailure, openTarget]);

  const open = useCallback((item: ProfileScreenshot) => {
    setOpenTarget({ screenshotId: item.id, ownerId: item.owner.id });
  }, []);

  const openById = useCallback((ownerId: string, screenshotId: string) => {
    fetchedIdsRef.current.delete(screenshotId);
    setFailures((current) => withoutKey(current, screenshotId));
    setDetachedById((current) => withoutKey(current, screenshotId));
    setOpenTarget({ screenshotId, ownerId });
  }, []);

  const close = useCallback(() => {
    setOpenTarget(null);
  }, []);

  const refreshScreenshot = useCallback(
    async (item: ProfileScreenshot) => {
      if (refreshedIdsRef.current.has(item.id)) return;
      refreshedIdsRef.current.add(item.id);

      try {
        const fresh = await fetchScreenshot(item.owner.id, item.id);
        if (fresh) onPatch(item.id, fresh);
      } catch (error) {
        logger.error("Failed to refresh screenshot", error);
        const failure = getScreenshotFailure(error);
        if (failure) markFailure(item.id, failure);
      }
    },
    [fetchScreenshot, markFailure, onPatch]
  );

  let status: ScreenshotLightboxStatus = "closed";
  if (openId) {
    if (failure) status = failure;
    else if (screenshot) status = "ready";
    else if (
      loadingIds.has(openId) ||
      (openTarget?.ownerId && !fetchedIdsRef.current.has(openId))
    ) {
      status = "loading";
    }
  }

  const index = screenshot
    ? feed.items.findIndex((item) => item.id === screenshot.id)
    : -1;

  return {
    feed,
    actions,
    onPatch,
    onRemove,
    lightbox: {
      status,
      screenshot,
      index,
      open,
      openById,
      close,
      refreshScreenshot,
      markFailure,
    },
  };
}

export type ScreenshotCollection = ReturnType<typeof useScreenshotCollection>;
