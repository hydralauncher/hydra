import { useCallback, useRef, useState } from "react";
import type { GamepadDirection } from "./use-gamepad";

const FOCUSABLE_SELECTOR = "[data-bp-focusable]";

const findScrollParent = (element: HTMLElement): HTMLElement | null => {
  let parent = element.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    if (
      style.overflowY === "auto" ||
      style.overflowY === "scroll" ||
      style.overflow === "auto" ||
      style.overflow === "scroll"
    ) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null;
};

export function useSpatialNavigation() {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const savedPositions = useRef<Record<string, number>>({});

  const getFocusableElements = useCallback((): HTMLElement[] => {
    return Array.from(document.querySelectorAll(FOCUSABLE_SELECTOR));
  }, []);

  const applyFocus = useCallback(
    (index: number) => {
      const elements = getFocusableElements();
      elements.forEach((el) => el.removeAttribute("data-bp-focused"));

      if (elements[index]) {
        elements[index].setAttribute("data-bp-focused", "true");

        if (index === 0) {
          const scrollParent = findScrollParent(elements[0]);
          if (scrollParent) {
            scrollParent.scrollTo({ top: 0, behavior: "smooth" });
          }
        } else {
          elements[index].scrollIntoView({
            block: "nearest",
            behavior: "smooth",
          });
        }
      }

      setFocusedIndex(index);
    },
    [getFocusableElements]
  );

  const navigate = useCallback(
    (direction: GamepadDirection) => {
      const elements = getFocusableElements();
      if (elements.length === 0) return;

      const current = elements[focusedIndex];
      if (!current) {
        applyFocus(0);
        return;
      }

      const currentRect = current.getBoundingClientRect();
      let bestIndex = -1;
      let bestDistance = Infinity;

      for (let i = 0; i < elements.length; i++) {
        if (i === focusedIndex) continue;

        const rect = elements[i].getBoundingClientRect();
        const cx = currentRect.left + currentRect.width / 2;
        const cy = currentRect.top + currentRect.height / 2;
        const tx = rect.left + rect.width / 2;
        const ty = rect.top + rect.height / 2;

        let isInDirection = false;

        switch (direction) {
          case "up":
            isInDirection = ty < cy - 5;
            break;
          case "down":
            isInDirection = ty > cy + 5;
            break;
          case "left":
            isInDirection = tx < cx - 5;
            break;
          case "right":
            isInDirection = tx > cx + 5;
            break;
        }

        if (!isInDirection) continue;

        const dx = tx - cx;
        const dy = ty - cy;

        // Apply cross-axis penalty so navigation favours items
        // aligned with the direction of movement (prevents diagonal
        // jumps in grids with variable-size items like Bento layouts).
        const CROSS_PENALTY = 3;
        let weighted: number;

        if (direction === "left" || direction === "right") {
          weighted = Math.sqrt(dx * dx + (dy * CROSS_PENALTY) ** 2);
        } else {
          weighted = Math.sqrt((dx * CROSS_PENALTY) ** 2 + dy * dy);
        }

        if (weighted < bestDistance) {
          bestDistance = weighted;
          bestIndex = i;
        }
      }

      if (bestIndex >= 0) {
        applyFocus(bestIndex);
      }
    },
    [focusedIndex, getFocusableElements, applyFocus]
  );

  const select = useCallback(() => {
    const elements = getFocusableElements();
    if (elements[focusedIndex]) {
      elements[focusedIndex].click();
    }
  }, [focusedIndex, getFocusableElements]);

  const savePosition = useCallback(
    (section: string) => {
      savedPositions.current[section] = focusedIndex;
    },
    [focusedIndex]
  );

  const restorePosition = useCallback(
    (section: string) => {
      const saved = savedPositions.current[section];
      if (saved !== undefined) {
        applyFocus(saved);
      } else {
        applyFocus(0);
      }
    },
    [applyFocus]
  );

  const resetFocus = useCallback(() => {
    applyFocus(0);
  }, [applyFocus]);

  const focusNth = useCallback(
    (n: number) => {
      const elements = getFocusableElements();
      if (elements.length === 0) return;
      const clamped = Math.max(0, Math.min(n, elements.length - 1));
      applyFocus(clamped);
    },
    [getFocusableElements, applyFocus]
  );

  return {
    focusedIndex,
    navigate,
    select,
    savePosition,
    restorePosition,
    resetFocus,
    focusNth,
  };
}
