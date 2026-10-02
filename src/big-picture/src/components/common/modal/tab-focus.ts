const MODAL_FOCUS_SELECTOR = [
  '[data-navigation-state="active"]',
  'button:not([tabindex="-1"])',
  'a[href]:not([tabindex="-1"])',
  'input:not([type="hidden"]):not([tabindex="-1"])',
  'select:not([tabindex="-1"])',
  'textarea:not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function trapModalTabFocus(
  event: KeyboardEvent,
  dialog: HTMLElement
): HTMLElement {
  event.preventDefault();
  event.stopPropagation();

  // FocusItem uses a roving tab index for controller navigation. Include its
  // active items even when their native tab index is -1.
  const controls = Array.from(
    dialog.querySelectorAll<HTMLElement>(MODAL_FOCUS_SELECTOR)
  ).filter((element) => {
    if (
      element.closest(
        '[hidden], [inert], [aria-hidden="true"], [aria-disabled="true"], [data-navigation-state="disabled"], [data-navigation-state="hidden"]'
      ) ||
      element.matches(":disabled") ||
      element.parentElement?.closest('[data-navigation-state="active"]') ||
      !element.getClientRects().length
    ) {
      return false;
    }

    const visibility =
      dialog.ownerDocument.defaultView?.getComputedStyle(element).visibility;
    return visibility !== "hidden" && visibility !== "collapse";
  });

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
