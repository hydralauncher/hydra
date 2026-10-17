import { useEffect, type RefObject } from "react";

/** Calls `onDismiss` on a click outside `ref` or on Escape while `isOpen`. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  isOpen: boolean,
  onDismiss: () => void
) {
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ref, isOpen, onDismiss]);
}
