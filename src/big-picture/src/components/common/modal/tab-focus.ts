const MODAL_FOCUS_SELECTOR = [
  '[data-navigation-state="active"]',
  'button:not([tabindex="-1"])',
  'a[href]:not([tabindex="-1"])',
  'input:not([type="hidden"]):not([tabindex="-1"])',
  'select:not([tabindex="-1"])',
  'textarea:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

const MODAL_EDITABLE_SELECTOR = "input,select,textarea";

export function trapModalTabFocus(
  event: KeyboardEvent,
  dialog: HTMLElement
): HTMLElement {
  event.preventDefault();
  event.stopPropagation();

  // FocusItem uses a roving tab index for controller navigation. Include its
  // active items even when their native tab index is -1.
  const candidates = Array.from(
    dialog.querySelectorAll<HTMLElement>(MODAL_FOCUS_SELECTOR)
  ).filter((element) => {
    if (
      element.closest(
        '[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"], [data-navigation-state="disabled"], [data-navigation-state="hidden"]'
      ) ||
      element.matches(":disabled") ||
      (element.parentElement?.closest('[data-navigation-state="active"]') &&
        !element.matches(MODAL_EDITABLE_SELECTOR)) ||
      !element.getClientRects().length
    ) {
      return false;
    }

    const visibility =
      dialog.ownerDocument.defaultView?.getComputedStyle(element).visibility;
    return visibility !== "hidden" && visibility !== "collapse";
  });

  // Native fields replace their controller wrapper in the Tab sequence.
  const editableControls = candidates.filter((element) =>
    element.matches(MODAL_EDITABLE_SELECTOR)
  );
  const controls = candidates.filter(
    (element) =>
      !editableControls.some(
        (control) => control !== element && element.contains(control)
      )
  );

  const focusedIndex = controls.findIndex(
    (element) =>
      element === dialog.ownerDocument.activeElement ||
      element.contains(dialog.ownerDocument.activeElement)
  );
  if (focusedIndex < 0) {
    const entryIndex = event.shiftKey ? controls.length - 1 : 0;
    return controls[entryIndex] ?? dialog;
  }

  const direction = event.shiftKey ? -1 : 1;
  const nextIndex =
    (focusedIndex + direction + controls.length) % controls.length;

  return controls[nextIndex] ?? dialog;
}
