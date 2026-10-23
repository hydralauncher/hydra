import type { ScreenshotHotkeyCandidate } from "@shared";

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
]);

export function isModifierKeyCode(code: string) {
  return MODIFIER_CODES.has(code);
}

export function getHotkeyFromKeyboardEvent(
  event: Pick<
    KeyboardEvent,
    "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
  >
): ScreenshotHotkeyCandidate {
  return {
    key: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
}
