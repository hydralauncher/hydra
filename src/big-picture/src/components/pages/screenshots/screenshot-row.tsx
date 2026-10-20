import "./screenshot-row.scss";

import { useEffect, useRef } from "react";
import type { ProfileScreenshot } from "@types";

import { HorizontalFocusGroup } from "../../common";
import type { FocusOverrideTarget } from "../../../services";
import { useNavigationStore } from "../../../stores";
import { ScreenshotCard } from "./screenshot-card";

const BLOCKED_TARGET: FocusOverrideTarget = { type: "block" };
const LOAD_MORE_THRESHOLD = 4;

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
  onLoadMore: () => void;
  onActivate: (screenshot: ProfileScreenshot) => void;
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
  onLoadMore,
  onActivate,
}: Readonly<ScreenshotRowProps>) {
  const rowRef = useRef<HTMLUListElement | null>(null);
  const sentinelRef = useRef<HTMLLIElement | null>(null);
  const currentFocusId = useNavigationStore((state) => state.currentFocusId);

  useEffect(() => {
    const row = rowRef.current;
    const sentinel = sentinelRef.current;

    if (!row || !sentinel || !hasMore || isLoadingMore) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onLoadMore();
      },
      { root: row, rootMargin: "0px 640px 0px 0px" }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, items.length, onLoadMore]);

  useEffect(() => {
    if (!hasMore || isLoadingMore || !currentFocusId) return;

    const focusedIndex = items.findIndex(
      (item) => getItemFocusId(item) === currentFocusId
    );

    if (focusedIndex >= 0 && focusedIndex >= items.length - LOAD_MORE_THRESHOLD)
      onLoadMore();
  }, [
    currentFocusId,
    getItemFocusId,
    hasMore,
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

            return (
              <ScreenshotCard
                key={screenshot.id}
                screenshot={screenshot}
                focusId={getItemFocusId(screenshot)}
                showOwnerDetails={showOwnerDetails}
                showAuthor={showAuthor}
                navigationOverrides={{
                  up: upTarget ?? BLOCKED_TARGET,
                  down: downTarget ?? BLOCKED_TARGET,
                  left: previous
                    ? { type: "item", itemId: getItemFocusId(previous) }
                    : (leftTarget ?? BLOCKED_TARGET),
                  right: next
                    ? { type: "item", itemId: getItemFocusId(next) }
                    : BLOCKED_TARGET,
                }}
                onActivate={onActivate}
              />
            );
          })}
          {hasMore ? (
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
