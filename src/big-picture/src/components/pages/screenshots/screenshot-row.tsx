import "./screenshot-row.scss";

import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot } from "@types";

import { FocusItem, HorizontalFocusGroup } from "../../common";
import type { FocusOverrideTarget } from "../../../services";
import { useNavigationStore } from "../../../stores";
import { ScreenshotCard } from "./screenshot-card";

const BLOCKED_TARGET: FocusOverrideTarget = { type: "block" };

const toItemTarget = (focusId: string | null): FocusOverrideTarget =>
  focusId ? { type: "item", itemId: focusId } : BLOCKED_TARGET;
const LOAD_MORE_THRESHOLD = 4;
const LOAD_MORE_PREFETCH_DISTANCE_PX = 640;

export interface ScreenshotRowProps {
  regionId: string;
  items: ProfileScreenshot[];
  getItemFocusId: (screenshot: ProfileScreenshot) => string;
  showOwnerDetails: boolean;
  showAuthor: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  upTarget?: FocusOverrideTarget;
  downTarget?: FocusOverrideTarget;
  leftTarget?: FocusOverrideTarget;
  hasLoadMoreError: boolean;
  retryFocusId: string;
  onRetryLoadMore: () => void;
  onLoadMore: () => void;
  likingIds?: ReadonlySet<string>;
  onActivate: (screenshot: ProfileScreenshot) => void;
  onLike?: (screenshot: ProfileScreenshot) => void;
  onRefreshImage?: (screenshot: ProfileScreenshot) => Promise<void>;
}

export function ScreenshotRow({
  regionId,
  items,
  getItemFocusId,
  showOwnerDetails,
  showAuthor,
  hasMore,
  isLoadingMore,
  upTarget,
  downTarget,
  leftTarget,
  hasLoadMoreError,
  retryFocusId,
  onRetryLoadMore,
  onLoadMore,
  likingIds,
  onActivate,
  onLike,
  onRefreshImage,
}: Readonly<ScreenshotRowProps>) {
  const { t } = useTranslation("big_picture");
  const rowRef = useRef<HTMLUListElement | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);
  const lastItem = items.at(-1);
  const canAutoLoad = hasMore && !hasLoadMoreError;

  useEffect(() => {
    const row = rowRef.current;
    const sentinel = sentinelRef.current;

    if (!row || !sentinel || !canAutoLoad || isLoadingMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadMore();
      },
      {
        root: row,
        rootMargin: `0px ${LOAD_MORE_PREFETCH_DISTANCE_PX}px 0px 0px`,
      }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [canAutoLoad, isLoadingMore, items.length, onLoadMore]);

  useEffect(() => {
    if (!canAutoLoad || isLoadingMore || !currentFocusId) return;

    const focusedIndex = items.findIndex(
      (item) => getItemFocusId(item) === currentFocusId
    );

    if (focusedIndex >= 0 && focusedIndex >= items.length - LOAD_MORE_THRESHOLD)
      onLoadMore();
  }, [
    canAutoLoad,
    currentFocusId,
    getItemFocusId,
    isLoadingMore,
    items,
    onLoadMore,
  ]);

  return (
    <div className="screenshot-row">
      <HorizontalFocusGroup regionId={regionId} autoScrollMode="item" asChild>
        <ul ref={rowRef} className="screenshot-row__list">
          {items.map((screenshot, index) => {
            const previous = items[index - 1];
            const next = items[index + 1];
            const nextFocusId = next ? getItemFocusId(next) : null;
            const rightFocusId = hasLoadMoreError ? retryFocusId : null;

            return (
              <ScreenshotCard
                key={screenshot.id}
                screenshot={screenshot}
                focusId={getItemFocusId(screenshot)}
                showOwnerDetails={showOwnerDetails}
                showAuthor={showAuthor}
                onRefreshImage={onRefreshImage}
                navigationOverrides={{
                  up: upTarget ?? BLOCKED_TARGET,
                  down: downTarget ?? BLOCKED_TARGET,
                  left: previous
                    ? { type: "item", itemId: getItemFocusId(previous) }
                    : (leftTarget ?? BLOCKED_TARGET),
                  right: toItemTarget(nextFocusId ?? rightFocusId),
                }}
                isLikePending={likingIds?.has(screenshot.id) ?? false}
                onActivate={onActivate}
                onLike={onLike}
              />
            );
          })}
          {hasLoadMoreError ? (
            <FocusItem
              id={retryFocusId}
              actions={{ primary: onRetryLoadMore }}
              navigationOverrides={{
                up: upTarget ?? BLOCKED_TARGET,
                down: downTarget ?? BLOCKED_TARGET,
                left: toItemTarget(lastItem ? getItemFocusId(lastItem) : null),
                right: BLOCKED_TARGET,
              }}
              asChild
            >
              <li className="screenshot-row__retry">
                <span>{t("screenshots_load_more_failed")}</span>
                <button
                  type="button"
                  className="screenshot-row__retry-button"
                  tabIndex={-1}
                  onClick={onRetryLoadMore}
                >
                  <ArrowClockwiseIcon size={18} />
                  {t("screenshots_retry")}
                </button>
              </li>
            </FocusItem>
          ) : null}
          {hasMore && !hasLoadMoreError ? (
            <li
              ref={sentinelRef}
              className="screenshot-row__sentinel"
              aria-hidden
            />
          ) : null}
        </ul>
      </HorizontalFocusGroup>
    </div>
  );
}
