import { useEffect, useRef } from "react";

interface LibraryPaginationOptions {
  enabled: boolean;
  isLoading: boolean;
  itemCount: number;
  onLoadMore: () => void;
}

export function useLibraryPagination({
  enabled,
  isLoading,
  itemCount,
  onLoadMore,
}: LibraryPaginationOptions) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = endRef.current;
    const root = document.getElementById("scrollableDiv");
    if (!target || !root || !enabled || isLoading) return;

    let requested = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!requested && entries.some((entry) => entry.isIntersecting)) {
          requested = true;
          onLoadMore();
        }
      },
      { root, rootMargin: "0px 0px 200px 0px" }
    );

    // Observe again after each page so a grid that still fits in the viewport
    // keeps loading without needing another scroll event.
    observer.observe(target);
    return () => {
      requested = true;
      observer.disconnect();
    };
  }, [enabled, isLoading, itemCount, onLoadMore]);

  return endRef;
}
