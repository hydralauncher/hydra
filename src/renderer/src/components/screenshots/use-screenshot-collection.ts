import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  applyScreenshotPatch,
  buildUserScreenshotPath,
  createScreenshotImageRefresher,
  getScreenshotApiErrorCode,
  isRelativeScreenshotPatch,
  type ScreenshotBusWrite,
  type ScreenshotPatch,
  type ScreenshotWriteBus,
} from "@shared";
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
  refreshKey?: string | number;
  fetchPage: (cursor: string | null) => Promise<ScreenshotFeedPage | null>;
  onServerTotal?: (total: number) => void;
  onItemRemoved?: (screenshot: ProfileScreenshot) => void;
  writeBus?: ScreenshotWriteBus;
}

interface OpenTarget {
  screenshotId: string;
  ownerId: string | null;
}

export function useScreenshotCollection({
  feedKey,
  refreshKey,
  fetchPage,
  onServerTotal,
  onItemRemoved,
  writeBus,
}: UseScreenshotCollectionOptions) {
  const onItemRemovedRef = useRef(onItemRemoved);
  onItemRemovedRef.current = onItemRemoved;
  const { userDetails } = useUserDetails();
  const fetchScreenshot = useCallback(
    async (ownerId: string, screenshotId: string) => {
      return window.electron.hydraApi.get<ProfileScreenshot>(
        buildUserScreenshotPath(ownerId, screenshotId),
        { needsAuth: Boolean(userDetails) }
      );
    },
    [userDetails]
  );

  const feed = useScreenshotFeed({
    feedKey,
    refreshKey,
    fetchPage,
    fetchScreenshot: (item) => fetchScreenshot(item.owner.id, item.id),
    onServerTotal,
  });
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
  const lastWriteAtRef = useRef(new Map<string, number>());
  const inFlightPatchesRef = useRef(new Map<string, ScreenshotPatch[]>());
  const relativeWritesRef = useRef(new Map<string, number>());
  const imageRefresherRef = useRef(createScreenshotImageRefresher());
  const lastOpenScreenshotRef = useRef<ProfileScreenshot | null>(null);

  const openId = openTarget?.screenshotId ?? null;
  const listItem = useMemo(
    () => feed.items.find((item) => item.id === openId) ?? null,
    [feed.items, openId]
  );
  const detached = openId ? (detachedById[openId] ?? null) : null;
  const freshScreenshot = pickNewerScreenshot(
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
  const lastOpenScreenshot =
    lastOpenScreenshotRef.current?.id === openId
      ? lastOpenScreenshotRef.current
      : null;
  const screenshot = freshScreenshot ?? lastOpenScreenshot;
  lastOpenScreenshotRef.current = screenshot;
  const failure = openId ? (failures[openId] ?? null) : null;

  const markFailure = useCallback(
    (screenshotId: string, nextFailure: ScreenshotFailure) => {
      setFailures((current) => ({ ...current, [screenshotId]: nextFailure }));
    },
    []
  );

  const applyPatch = useCallback(
    (screenshotId: string, patch: ScreenshotPatch) => {
      lastWriteAtRef.current.set(screenshotId, performance.now());
      inFlightPatchesRef.current.get(screenshotId)?.push(patch);
      if (isRelativeScreenshotPatch(patch)) {
        bumpWriteVersion(relativeWritesRef.current, screenshotId);
      }
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

  const applyRemoval = useCallback(
    (screenshotId: string) => {
      fetchedIdsRef.current.add(screenshotId);
      removeItem(screenshotId);
      setDetachedById((current) => withoutKey(current, screenshotId));
    },
    [removeItem]
  );

  const publishRef = useRef<((write: ScreenshotBusWrite) => void) | null>(null);

  useEffect(() => {
    if (!writeBus) return;

    const subscription = writeBus.subscribe(({ screenshotId, patch }) => {
      if (patch === null) applyRemoval(screenshotId);
      else applyPatch(screenshotId, patch);
    });
    publishRef.current = subscription.publish;

    return () => {
      subscription.unsubscribe();
      publishRef.current = null;
    };
  }, [applyPatch, applyRemoval, writeBus]);

  const onPatch = useCallback(
    (screenshotId: string, patch: ScreenshotPatch) => {
      applyPatch(screenshotId, patch);
      publishRef.current?.({ screenshotId, patch });
    },
    [applyPatch]
  );

  const onRemove = useCallback(
    (removed: ProfileScreenshot) => {
      applyRemoval(removed.id);
      onItemRemovedRef.current?.(removed);
      publishRef.current?.({ screenshotId: removed.id, patch: null });
    },
    [applyRemoval]
  );

  const actions = useScreenshotActions({
    onPatch,
    onRemove,
    onFailure: markFailure,
  });

  const recountDetached = useCallback(
    async (ownerId: string, screenshotId: string): Promise<void> => {
      const startedVersion = relativeWritesRef.current.get(screenshotId) ?? 0;

      try {
        const fresh = await fetchScreenshot(ownerId, screenshotId);
        if (!fresh) return;

        const currentVersion = relativeWritesRef.current.get(screenshotId) ?? 0;
        if (currentVersion !== startedVersion) {
          return recountDetached(ownerId, screenshotId);
        }

        setDetachedById((current) =>
          screenshotId in current
            ? {
                ...current,
                [screenshotId]: {
                  ...current[screenshotId],
                  commentCount: fresh.commentCount,
                },
              }
            : current
        );
      } catch (error) {
        logger.warn("Failed to refresh the screenshot comment count", error);
      }
    },
    [fetchScreenshot]
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
            [screenshotId]: localPatches
              .filter((patch) => !isRelativeScreenshotPatch(patch))
              .reduce(applyScreenshotPatch, item),
          }));
          if (localPatches.some(isRelativeScreenshotPatch)) {
            void recountDetached(ownerId, screenshotId);
          }
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
  }, [
    detached,
    failure,
    fetchScreenshot,
    listItem,
    markFailure,
    openTarget,
    recountDetached,
  ]);

  const open = useCallback((item: ProfileScreenshot) => {
    setFailures((current) => withoutKey(current, item.id));
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
    (item: ProfileScreenshot) =>
      imageRefresherRef.current.run(item.id, async () => {
        try {
          const fresh = await fetchScreenshot(item.owner.id, item.id);
          if (!fresh) return;

          onPatch(item.id, {
            imageUrl: fresh.imageUrl,
            thumbnailUrl: fresh.thumbnailUrl,
          });
        } catch (error) {
          logger.error("Failed to refresh screenshot", error);
          const failure = getScreenshotFailure(error);
          if (failure) markFailure(item.id, failure);
        }
      }),
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
