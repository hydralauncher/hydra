import { useCallback, useEffect, type RefObject } from "react";

import { moveFocusWithinContainer } from "@renderer/hooks/use-focus-trap";

const DIALOG_SELECTOR = "[role=dialog], dialog[open]";

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

const isTopMostDialog = (dialog: HTMLElement | null) => {
  const dialogs = Array.from(document.querySelectorAll(DIALOG_SELECTOR));
  return dialog !== null && dialogs.at(-1) === dialog;
};

interface UseLightboxKeyboardOptions {
  isEnabled: boolean;
  dialogRef: RefObject<HTMLElement>;
  onClose: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}

export function useLightboxKeyboard({
  isEnabled,
  dialogRef,
  onClose,
  onPrevious,
  onNext,
}: UseLightboxKeyboardOptions) {
  const handleArrowKey = useCallback(
    (key: string) => {
      if (key === "ArrowLeft") onPrevious?.();
      if (key === "ArrowRight") onNext?.();
    },
    [onNext, onPrevious]
  );

  useEffect(() => {
    if (!isEnabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (event.defaultPrevented || !dialog || !isTopMostDialog(dialog)) {
        return;
      }

      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Tab") {
        event.preventDefault();
        moveFocusWithinContainer(dialog, event.shiftKey);
      } else if (!isTypingTarget(event.target)) {
        handleArrowKey(event.key);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dialogRef, handleArrowKey, isEnabled, onClose]);
}

export function useLightboxFocus(
  isOpen: boolean,
  initialFocusRef: RefObject<HTMLElement>,
  focusKey: string
) {
  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    return () => {
      previouslyFocused?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    initialFocusRef.current?.focus();
  }, [focusKey, initialFocusRef, isOpen]);
}
