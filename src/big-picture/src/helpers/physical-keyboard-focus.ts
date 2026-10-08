const physicalKeyboardFocusTargets = new WeakSet<HTMLElement>();

export function isPhysicalKeyboardFocus(target: HTMLElement): boolean {
  return physicalKeyboardFocusTargets.has(target);
}

export function focusWithPhysicalKeyboard(target: HTMLElement): void {
  const alreadySuppressed = physicalKeyboardFocusTargets.has(target);
  physicalKeyboardFocusTargets.add(target);

  // focusin fires synchronously; controller focus after this call is unaffected.
  try {
    target.focus({ preventScroll: true });
  } finally {
    if (!alreadySuppressed) physicalKeyboardFocusTargets.delete(target);
  }
}
