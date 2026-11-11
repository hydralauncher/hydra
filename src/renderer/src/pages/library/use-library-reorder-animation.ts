import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const ITEM_SELECTOR = "[data-library-order-key]";
const DURATION = 240;
const EASING = "cubic-bezier(0.2, 0, 0, 1)";

export interface LibraryReorderSettle {
  key: string;
  fromRect: DOMRect;
}

interface ReorderSnapshot {
  rects: Map<string, DOMRect>;
  settle?: LibraryReorderSettle;
}

const getItems = (root: HTMLElement) =>
  root.querySelectorAll<HTMLElement>(ITEM_SELECTOR);

const prefersReducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const animateSettle = (item: HTMLElement, deltaX: number, deltaY: number) => {
  item.animate(
    [
      {
        transform: `translate(${deltaX}px, ${deltaY}px) rotate(3deg) scale(1.05)`,
      },
      { transform: "none" },
    ],
    { duration: DURATION, easing: EASING }
  );

  item.firstElementChild?.animate(
    [
      { opacity: 1, filter: "none", transform: "none" },
      { opacity: 1, filter: "none", transform: "none" },
    ],
    { duration: DURATION }
  );
};

export function useLibraryReorderAnimation(rootRef: RefObject<HTMLElement>) {
  const snapshotRef = useRef<ReorderSnapshot | null>(null);
  const [tick, setTick] = useState(0);

  const captureBeforeReorder = useCallback(
    (settle?: LibraryReorderSettle) => {
      const root = rootRef.current;
      if (!root || prefersReducedMotion()) return;

      const rects = new Map<string, DOMRect>();
      for (const item of getItems(root)) {
        const key = item.dataset.libraryOrderKey;
        if (key) rects.set(key, item.getBoundingClientRect());
      }
      if (settle) rects.set(settle.key, settle.fromRect);

      snapshotRef.current = { rects, settle };
      setTick((value) => value + 1);
    },
    [rootRef]
  );

  useLayoutEffect(() => {
    const snapshot = snapshotRef.current;
    snapshotRef.current = null;

    const root = rootRef.current;
    if (!snapshot || !root) return;

    for (const item of getItems(root)) {
      const key = item.dataset.libraryOrderKey;
      if (!key) continue;

      const previous = snapshot.rects.get(key);
      if (!previous) {
        item.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: DURATION,
          easing: EASING,
        });
        continue;
      }

      const current = item.getBoundingClientRect();
      const deltaX = previous.left - current.left;
      const deltaY = previous.top - current.top;

      if (key === snapshot.settle?.key) {
        animateSettle(item, deltaX, deltaY);
        continue;
      }

      if (deltaX === 0 && deltaY === 0) continue;

      item.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "none" },
        ],
        { duration: DURATION, easing: EASING }
      );
    }
  }, [tick, rootRef]);

  return captureBeforeReorder;
}
