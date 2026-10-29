import type { ScreenshotGamepadButton, ScreenshotHotkeyBinding } from "@types";

export const DEFAULT_SCREENSHOT_HOTKEY: Readonly<ScreenshotHotkeyBinding> = {
  key: "F10",
  ctrl: false,
  alt: false,
  shift: false,
};

export const DEFAULT_SCREENSHOT_GAMEPAD_COMBO: readonly ScreenshotGamepadButton[] =
  ["back", "ls"];

export const SCREENSHOT_GAMEPAD_COMBO_MIN_BUTTONS = 2;
export const SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS = 4;

export const SCREENSHOT_GAMEPAD_BUTTONS: readonly ScreenshotGamepadButton[] = [
  "a",
  "b",
  "x",
  "y",
  "lb",
  "rb",
  "lt",
  "rt",
  "back",
  "start",
  "ls",
  "rs",
  "dpadUp",
  "dpadDown",
  "dpadLeft",
  "dpadRight",
];

const LETTER_KEYS = Array.from(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  (letter) => `Key${letter}`
);
const DIGIT_KEYS = Array.from("0123456789", (digit) => `Digit${digit}`);
const FUNCTION_KEYS = Array.from({ length: 24 }, (_, index) => `F${index + 1}`);
const NUMPAD_DIGIT_KEYS = Array.from("0123456789", (digit) => `Numpad${digit}`);
const NUMPAD_KEYS = [
  ...NUMPAD_DIGIT_KEYS,
  "NumpadAdd",
  "NumpadSubtract",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadDecimal",
  "NumpadEnter",
];
const PUNCTUATION_KEYS = [
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
];
const TYPING_CONTROL_KEYS = ["Space", "Enter", "Tab", "Backspace"];
const ARROW_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
const NAVIGATION_KEYS = [
  "Insert",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
];
const SYSTEM_KEYS = ["Escape", "PrintScreen", "ScrollLock", "Pause"];

export const SCREENSHOT_HOTKEY_KEYS: readonly string[] = [
  ...FUNCTION_KEYS,
  ...LETTER_KEYS,
  ...DIGIT_KEYS,
  ...NUMPAD_KEYS,
  ...PUNCTUATION_KEYS,
  ...TYPING_CONTROL_KEYS,
  ...ARROW_KEYS,
  ...NAVIGATION_KEYS,
  ...SYSTEM_KEYS,
];

const KEYS_REQUIRING_MODIFIER = new Set([
  ...LETTER_KEYS,
  ...DIGIT_KEYS,
  ...NUMPAD_DIGIT_KEYS,
  ...PUNCTUATION_KEYS,
  ...TYPING_CONTROL_KEYS,
  ...ARROW_KEYS,
]);

const SUPPORTED_KEYS = new Set(SCREENSHOT_HOTKEY_KEYS);
const SUPPORTED_GAMEPAD_BUTTONS = new Set<string>(SCREENSHOT_GAMEPAD_BUTTONS);

export interface ScreenshotHotkeyCandidate extends ScreenshotHotkeyBinding {
  meta?: boolean;
}

export type ScreenshotHotkeyError =
  | "hotkey_reserved"
  | "hotkey_modifier_required"
  | "hotkey_unsupported_key";

export type ScreenshotGamepadComboError =
  | "gamepad_combo_too_short"
  | "gamepad_combo_too_long"
  | "gamepad_combo_unsupported_button";

export type ScreenshotInputValidation<TError extends string> =
  | { valid: true }
  | { valid: false; error: TError };

const isReservedHotkey = ({
  key,
  ctrl,
  alt,
  meta,
}: ScreenshotHotkeyCandidate) => {
  if (meta || key === "Escape") return true;
  if (alt && (key === "F4" || key === "Tab")) return true;
  if (alt && !ctrl && key === "Space") return true;
  if (ctrl && alt && (key === "Delete" || key === "Backspace")) return true;
  return ctrl && alt && /^F([1-9]|1[0-2])$/.test(key);
};

export const validateScreenshotHotkey = (
  candidate: ScreenshotHotkeyCandidate
): ScreenshotInputValidation<ScreenshotHotkeyError> => {
  if (!SUPPORTED_KEYS.has(candidate.key)) {
    return { valid: false, error: "hotkey_unsupported_key" };
  }

  if (isReservedHotkey(candidate)) {
    return { valid: false, error: "hotkey_reserved" };
  }

  if (
    KEYS_REQUIRING_MODIFIER.has(candidate.key) &&
    !candidate.ctrl &&
    !candidate.alt
  ) {
    return { valid: false, error: "hotkey_modifier_required" };
  }

  return { valid: true };
};

const isHotkeyShape = (value: unknown): value is ScreenshotHotkeyBinding => {
  if (!value || typeof value !== "object") return false;
  const binding = value as Record<string, unknown>;
  return (
    typeof binding.key === "string" &&
    typeof binding.ctrl === "boolean" &&
    typeof binding.alt === "boolean" &&
    typeof binding.shift === "boolean"
  );
};

export const normalizeScreenshotHotkey = (
  value: unknown
): ScreenshotHotkeyBinding => {
  if (isHotkeyShape(value) && validateScreenshotHotkey(value).valid) {
    return {
      key: value.key,
      ctrl: value.ctrl,
      alt: value.alt,
      shift: value.shift,
    };
  }

  return { ...DEFAULT_SCREENSHOT_HOTKEY };
};

export const isSameScreenshotHotkey = (
  left: ScreenshotHotkeyBinding,
  right: ScreenshotHotkeyBinding
) =>
  left.key === right.key &&
  left.ctrl === right.ctrl &&
  left.alt === right.alt &&
  left.shift === right.shift;

const ACCELERATOR_KEY_NAMES: Readonly<Record<string, string>> = {
  NumpadAdd: "numadd",
  NumpadSubtract: "numsub",
  NumpadMultiply: "nummult",
  NumpadDivide: "numdiv",
  NumpadDecimal: "numdec",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ScrollLock: "Scrolllock",
};

const PASSTHROUGH_ACCELERATOR_KEYS = new Set([
  ...FUNCTION_KEYS,
  ...TYPING_CONTROL_KEYS,
  ...NAVIGATION_KEYS,
  "Escape",
  "PrintScreen",
]);

const toAcceleratorKey = (key: string) => {
  if (Object.hasOwn(ACCELERATOR_KEY_NAMES, key))
    return ACCELERATOR_KEY_NAMES[key];
  if (PASSTHROUGH_ACCELERATOR_KEYS.has(key)) return key;
  if (/^Key[A-Z]$/.test(key)) return key.slice(3);
  if (/^Digit\d$/.test(key)) return key.slice(5);
  if (/^Numpad\d$/.test(key)) return `num${key.slice(6)}`;
  return null;
};

export const toScreenshotHotkeyAccelerator = (
  binding: ScreenshotHotkeyBinding
) => {
  const key = toAcceleratorKey(binding.key);
  if (!key) return null;

  return [
    binding.ctrl ? "Control" : null,
    binding.alt ? "Alt" : null,
    binding.shift ? "Shift" : null,
    key,
  ]
    .filter(Boolean)
    .join("+");
};

export const validateScreenshotGamepadCombo = (
  buttons: readonly string[]
): ScreenshotInputValidation<ScreenshotGamepadComboError> => {
  if (buttons.some((button) => !SUPPORTED_GAMEPAD_BUTTONS.has(button))) {
    return { valid: false, error: "gamepad_combo_unsupported_button" };
  }

  const uniqueCount = new Set(buttons).size;

  if (uniqueCount < SCREENSHOT_GAMEPAD_COMBO_MIN_BUTTONS) {
    return { valid: false, error: "gamepad_combo_too_short" };
  }

  if (uniqueCount > SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS) {
    return { valid: false, error: "gamepad_combo_too_long" };
  }

  return { valid: true };
};

export const normalizeScreenshotGamepadCombo = (
  value: unknown
): ScreenshotGamepadButton[] => {
  if (
    Array.isArray(value) &&
    value.every((button) => typeof button === "string") &&
    validateScreenshotGamepadCombo(value).valid
  ) {
    return SCREENSHOT_GAMEPAD_BUTTONS.filter((button) =>
      value.includes(button)
    );
  }

  return [...DEFAULT_SCREENSHOT_GAMEPAD_COMBO];
};

export const isSameScreenshotGamepadCombo = (
  left: readonly ScreenshotGamepadButton[],
  right: readonly ScreenshotGamepadButton[]
) =>
  left.length === right.length &&
  left.every((button) => right.includes(button));
