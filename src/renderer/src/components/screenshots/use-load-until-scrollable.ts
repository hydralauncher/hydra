import { useEffect, useRef } from "react";

const FILL_MARGIN_PX = 48;

interface UseLoadUntilScrollableOptions {
  scrollTargetId: string;
  canLoadMore: boolean;
  itemCount: number;
  loadMore: () => unknown;
}

export const needsMoreToScroll = (target: HTMLElement) =>
  target.scrollHeight <= target.clientHeight + FILL_MARGIN_PX;

export function useLoadUntilScrollable({
  scrollTargetId,
  canLoadMore,
  itemCount,
  loadMore,
}: UseLoadUntilScrollableOptions) {
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    if (!canLoadMore) return;
    const target = document.getElementById(scrollTargetId);
    if (!target) return;

    const check = () => {
      if (needsMoreToScroll(target)) loadMoreRef.current();
    };
    const frame = requestAnimationFrame(check);
    const observer = new ResizeObserver(check);
    observer.observe(target);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [canLoadMore, itemCount, scrollTargetId]);
}
