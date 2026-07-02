export function getMouseFocusTargetId(
  target: EventTarget | null
): string | null {
  if (!(target instanceof HTMLElement)) return null;

  return target.closest<HTMLElement>("[data-navigation-state]")?.id ?? null;
}

export function shouldEnterMouseMode(
  mode: "gamepad" | "mouse",
  hasRecentGamepadActivity: boolean
): boolean {
  return mode === "gamepad" && !hasRecentGamepadActivity;
}
