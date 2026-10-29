import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

const DEFAULT_OVERSCAN = 8;

export interface VirtualListOptions {
  count: number;
  scrollRef: RefObject<HTMLElement | null>;
  getItemKey: (index: number) => string;
  estimateSize: (index: number) => number;
  padding?: number;
  inset?: number;
  gap?: number;
  overscan?: number;
}

export function useVirtualList({
  count,
  scrollRef,
  getItemKey,
  estimateSize,
  padding = 0,
  inset = 0,
  gap = 0,
  overscan = DEFAULT_OVERSCAN,
}: VirtualListOptions) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = scrollRef.current;
    if (!list || !scroller) return;

    const update = () => {
      setScrollMargin(
        list.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop
      );
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    for (const child of scroller.children) observer.observe(child);
    let previous = list.previousElementSibling;
    while (previous) {
      observer.observe(previous);
      previous = previous.previousElementSibling;
    }

    return () => observer.disconnect();
  }, [scrollRef, count]);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    getItemKey,
    overscan,
    scrollMargin,
    paddingStart: padding,
    paddingEnd: padding,
    gap,
  });

  const getRowProps = (index: number, start: number) => ({
    "data-index": index,
    ref: virtualizer.measureElement,
    style: {
      position: "absolute" as const,
      top: 0,
      left: inset,
      right: inset,
      transform: `translateY(${start - scrollMargin}px)`,
    },
  });

  return { listRef, virtualizer, getRowProps };
}
