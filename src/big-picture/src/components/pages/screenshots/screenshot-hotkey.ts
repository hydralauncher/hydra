import type { ScreenshotHotkeyCandidate } from "@shared";

const PRINT_SCREEN_CODE = "PrintScreen";

const PRINT_SCREEN_MODIFIER_GRACE_MS = 500;

type HotkeyModifier = "ctrl" | "alt" | "shift" | "meta";

type HotkeyKeyEvent = Pick<
  KeyboardEvent,
  "type" | "code" | "repeat" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

const MODIFIER_CODES = new Map<string, HotkeyModifier>([
  ["ControlLeft", "ctrl"],
  ["ControlRight", "ctrl"],
  ["AltLeft", "alt"],
  ["AltRight", "alt"],
  ["ShiftLeft", "shift"],
  ["ShiftRight", "shift"],
  ["MetaLeft", "meta"],
  ["MetaRight", "meta"],
  ["OSLeft", "meta"],
  ["OSRight", "meta"],
  ["AltGraph", "alt"],
]);

export function isPrintScreenKeyCode(code: string) {
  return code === PRINT_SCREEN_CODE;
}

export function createScreenshotHotkeyRecorder(
  onKey: (candidate: ScreenshotHotkeyCandidate) => void
) {
  const modifierReleasedAt = new Map<HotkeyModifier, number | null>();

  const trackModifier = (event: HotkeyKeyEvent) => {
    const modifier = MODIFIER_CODES.get(event.code);
    if (!modifier) return;
    modifierReleasedAt.set(
      modifier,
      event.type === "keydown" ? null : performance.now()
    );
  };

  const wasModifierHeld = (modifier: HotkeyModifier) => {
    const releasedAt = modifierReleasedAt.get(modifier);
    if (releasedAt === undefined) return false;
    return (
      releasedAt === null ||
      performance.now() - releasedAt <= PRINT_SCREEN_MODIFIER_GRACE_MS
    );
  };

  const record = (event: HotkeyKeyEvent) => {
    const isPrintScreen = isPrintScreenKeyCode(event.code);
    const isHeld = (pressed: boolean, modifier: HotkeyModifier) =>
      pressed || (isPrintScreen && wasModifierHeld(modifier));

    onKey({
      key: event.code,
      ctrl: isHeld(event.ctrlKey, "ctrl"),
      alt: isHeld(event.altKey, "alt"),
      shift: isHeld(event.shiftKey, "shift"),
      meta: isHeld(event.metaKey, "meta"),
    });
  };

  return {
    handleKeyDown(event: HotkeyKeyEvent) {
      trackModifier(event);
      if (
        event.repeat ||
        MODIFIER_CODES.has(event.code) ||
        isPrintScreenKeyCode(event.code)
      )
        return;
      record(event);
    },
    handleKeyUp(event: HotkeyKeyEvent) {
      trackModifier(event);
      if (isPrintScreenKeyCode(event.code)) record(event);
    },
    forgetModifiers() {
      modifierReleasedAt.clear();
    },
  };
}
