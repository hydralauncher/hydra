import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export const getFocusableElements = (container: HTMLElement) =>
  Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(
    (element) => element.closest("[inert]") === null && element.tabIndex >= 0
  );

export const moveFocusWithinContainer = (
  container: HTMLElement,
  backwards: boolean
) => {
  const focusable = getFocusableElements(container);
  if (!focusable.length) {
    container.focus();
    return;
  }

  const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
  const lastIndex = focusable.length - 1;
  let nextIndex = backwards ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex === -1) nextIndex = backwards ? lastIndex : 0;
  if (nextIndex < 0) nextIndex = lastIndex;
  if (nextIndex > lastIndex) nextIndex = 0;

  focusable[nextIndex].focus();
};

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  paused = false
) {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (!active) return;

    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const [firstFocusable] = getFocusableElements(container);
    (firstFocusable ?? container).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || pausedRef.current) return;
      event.preventDefault();
      moveFocusWithinContainer(container, event.shiftKey);
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, containerRef]);
}
