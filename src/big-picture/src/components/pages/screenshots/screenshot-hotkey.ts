import type { ScreenshotHotkeyBinding } from "@types";

const LETTER_KEYS = "QWERTYUIOPASDFGHJKLZXCVBNM"
  .split("")
  .map((letter) => `Key${letter}`);
const DIGIT_KEYS = "0123456789".split("").map((digit) => `Digit${digit}`);
const NUMPAD_KEYS = [
  ..."0123456789".split("").map((digit) => `Numpad${digit}`),
  "NumpadMultiply",
  "NumpadSubtract",
  "NumpadAdd",
  "NumpadDecimal",
  "NumpadDivide",
  "NumpadEnter",
];
const FUNCTION_KEYS = Array.from({ length: 24 }, (_, index) => `F${index + 1}`);
const PUNCTUATION_KEYS = [
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Semicolon",
  "Quote",
  "Backquote",
  "Backslash",
  "Comma",
  "Period",
  "Slash",
];
const NAVIGATION_KEYS = [
  "Escape",
  "Backspace",
  "Tab",
  "Enter",
  "Space",
  "ScrollLock",
  "PrintScreen",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Insert",
  "Delete",
  "Pause",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
];

const SUPPORTED_KEYS = new Set([
  ...LETTER_KEYS,
  ...DIGIT_KEYS,
  ...NUMPAD_KEYS,
  ...FUNCTION_KEYS,
  ...PUNCTUATION_KEYS,
  ...NAVIGATION_KEYS,
]);
const TYPING_KEYS = new Set([
  ...LETTER_KEYS,
  ...DIGIT_KEYS,
  ...PUNCTUATION_KEYS,
  "Space",
]);
const RESERVED_UNMODIFIED_KEYS = new Set([
  "Escape",
  "Backspace",
  "Tab",
  "Enter",
  "NumpadEnter",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);
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

export type ScreenshotHotkeyError = "unsupported" | "reserved" | "typing";

export function isModifierKeyCode(code: string) {
  return MODIFIER_CODES.has(code);
}

export function getHotkeyFromKeyboardEvent(
  event: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey">
): ScreenshotHotkeyBinding {
  return {
    key: event.code,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  };
}

export function validateScreenshotHotkey(
  binding: ScreenshotHotkeyBinding,
  hasMetaModifier = false
): ScreenshotHotkeyError | null {
  if (hasMetaModifier || !SUPPORTED_KEYS.has(binding.key)) return "unsupported";

  const hasModifier = binding.ctrl || binding.alt;

  if (binding.alt && (binding.key === "F4" || binding.key === "Tab"))
    return "reserved";
  if (binding.ctrl && binding.alt && binding.key === "Delete")
    return "reserved";
  if (
    !hasModifier &&
    !binding.shift &&
    RESERVED_UNMODIFIED_KEYS.has(binding.key)
  )
    return "reserved";
  if (!hasModifier && TYPING_KEYS.has(binding.key)) return "typing";

  return null;
}

function formatKeyCode(code: string) {
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  if (code.startsWith("Arrow")) return code.slice(5);

  return code;
}

export function formatScreenshotHotkeyLabel(binding: ScreenshotHotkeyBinding) {
  return [
    binding.ctrl ? "Ctrl" : null,
    binding.alt ? "Alt" : null,
    binding.shift ? "Shift" : null,
    formatKeyCode(binding.key),
  ]
    .filter((part): part is string => part !== null)
    .join(" + ");
}

export function isSameScreenshotHotkey(
  left: ScreenshotHotkeyBinding,
  right: ScreenshotHotkeyBinding
) {
  return (
    left.key === right.key &&
    left.ctrl === right.ctrl &&
    left.alt === right.alt &&
    left.shift === right.shift
  );
}
