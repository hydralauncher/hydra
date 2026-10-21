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
  applyScreenshotPatch,
  useScreenshotFeed,
  type ScreenshotFeedPage,
  type ScreenshotPatch,
} from "./use-screenshot-feed";

const getScreenshotFailure = (error: unknown): ScreenshotFailure | null => {
  const code = getScreenshotApiErrorCode(error);
  if (code === "screenshots/private") return "private";
  if (code === "screenshots/not-found") return "unavailable";
  return null;
};

const pickNewerScreenshot = (
  listItem: ProfileScreenshot | null,
  listFetchedAt: number | null,
  detached: ProfileScreenshot | null,
  detachedFetchedAt: number | null
) => {
  if (!listItem || !detached) return listItem ?? detached;
  return (detachedFetchedAt ?? 0) > (listFetchedAt ?? 0) ? detached : listItem;
};

const bumpWriteVersion = (versions: Map<string, number>, id: string) => {
  versions.set(id, (versions.get(id) ?? 0) + 1);
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
  const detachedFetchedAtRef = useRef(new Map<string, number>());
  const writeVersionsRef = useRef(new Map<string, number>());
  const lastWriteAtRef = useRef(new Map<string, number>());
  const inFlightPatchesRef = useRef(new Map<string, ScreenshotPatch[]>());
  const refreshedIdsRef = useRef(new Set<string>());

  const openId = openTarget?.screenshotId ?? null;
  const listItem = useMemo(
    () => feed.items.find((item) => item.id === openId) ?? null,
    [feed.items, openId]
  );
  const detached = openId ? (detachedById[openId] ?? null) : null;
  const screenshot = pickNewerScreenshot(
    listItem,
    listItem
      ? Math.max(
          feed.getFetchedAt(listItem.id) ?? 0,
          lastWriteAtRef.current.get(listItem.id) ?? 0
        )
      : null,
    detached,
    detached ? (detachedFetchedAtRef.current.get(detached.id) ?? null) : null
  );
  const failure = openId ? (failures[openId] ?? null) : null;

  const markFailure = useCallback(
    (screenshotId: string, nextFailure: ScreenshotFailure) => {
      setFailures((current) => ({ ...current, [screenshotId]: nextFailure }));
    },
    []
  );

  const onPatch = useCallback(
    (screenshotId: string, patch: ScreenshotPatch) => {
      bumpWriteVersion(writeVersionsRef.current, screenshotId);
      lastWriteAtRef.current.set(screenshotId, performance.now());
      inFlightPatchesRef.current.get(screenshotId)?.push(patch);
      patchItem(screenshotId, patch);
      setDetachedById((current) =>
        screenshotId in current
          ? {
              ...current,
              [screenshotId]: applyScreenshotPatch(
                current[screenshotId],
                patch
              ),
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

    const startedAt = performance.now();
    requestTokensRef.current.set(screenshotId, token);
    inFlightPatchesRef.current.set(screenshotId, []);
    fetchedIdsRef.current.add(screenshotId);
    setLoadingIds((current) => new Set(current).add(screenshotId));

    fetchScreenshot(ownerId, screenshotId)
      .then((item) => {
        if (!isCurrentRequest()) return;
        const localPatches = inFlightPatchesRef.current.get(screenshotId) ?? [];
        inFlightPatchesRef.current.delete(screenshotId);
        if (item) {
          detachedFetchedAtRef.current.set(screenshotId, startedAt);
          setDetachedById((current) => ({
            ...current,
            [screenshotId]: localPatches.reduce(applyScreenshotPatch, item),
          }));
        } else {
          markFailure(screenshotId, "unavailable");
        }
      })
      .catch((error) => {
        if (!isCurrentRequest()) return;
        inFlightPatchesRef.current.delete(screenshotId);
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

      const startVersion = writeVersionsRef.current.get(item.id) ?? 0;

      try {
        const fresh = await fetchScreenshot(item.owner.id, item.id);
        if (!fresh) return;

        const hasLocalWrite =
          (writeVersionsRef.current.get(item.id) ?? 0) !== startVersion;
        onPatch(
          item.id,
          hasLocalWrite
            ? { imageUrl: fresh.imageUrl, thumbnailUrl: fresh.thumbnailUrl }
            : fresh
        );
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

  return {
    feed,
    actions,
    onPatch,
    onRemove,
    lightbox: {
      status,
      screenshot,
      open,
      openById,
      close,
      refreshScreenshot,
      markFailure,
    },
  };
}

export type ScreenshotCollection = ReturnType<typeof useScreenshotCollection>;
