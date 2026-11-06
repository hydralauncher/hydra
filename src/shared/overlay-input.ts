import type {
  OverlayHotkeyBinding,
  OverlayHotkeyModifier,
  ScreenshotHotkeyBinding,
} from "@types";
import {
  SCREENSHOT_HOTKEY_KEYS,
  type ScreenshotInputValidation,
} from "./screenshot-input.js";
import { formatScreenshotHotkey } from "./screenshot-preferences.js";

export const DEFAULT_OVERLAY_HOTKEY: Readonly<OverlayHotkeyBinding> = {
  modifier: "shift",
  key: "Tab",
};

const MODIFIERS: readonly OverlayHotkeyModifier[] = ["shift", "alt"];

const SUPPORTED_KEYS = new Set(
  SCREENSHOT_HOTKEY_KEYS.filter((key) => key !== "PrintScreen")
);

const RESERVED_KEYS = new Set(["Escape"]);

const RESERVED_ALT_KEYS = new Set(["Tab", "F4", "Space", "Escape"]);

export type OverlayHotkeyError = "hotkey_reserved" | "hotkey_unsupported_key";

export const validateOverlayHotkey = (
  candidate: OverlayHotkeyBinding
): ScreenshotInputValidation<OverlayHotkeyError> => {
  if (!SUPPORTED_KEYS.has(candidate.key)) {
    return { valid: false, error: "hotkey_unsupported_key" };
  }

  if (RESERVED_KEYS.has(candidate.key)) {
    return { valid: false, error: "hotkey_reserved" };
  }

  if (candidate.modifier === "alt" && RESERVED_ALT_KEYS.has(candidate.key)) {
    return { valid: false, error: "hotkey_reserved" };
  }

  return { valid: true };
};

const isOverlayHotkeyShape = (
  value: unknown
): value is OverlayHotkeyBinding => {
  if (!value || typeof value !== "object") return false;
  const binding = value as Record<string, unknown>;
  return (
    typeof binding.modifier === "string" &&
    MODIFIERS.includes(binding.modifier as OverlayHotkeyModifier) &&
    typeof binding.key === "string"
  );
};

export const normalizeOverlayHotkey = (
  value: unknown
): OverlayHotkeyBinding => {
  if (isOverlayHotkeyShape(value) && validateOverlayHotkey(value).valid) {
    return { modifier: value.modifier, key: value.key };
  }

  return { ...DEFAULT_OVERLAY_HOTKEY };
};

export const isSameOverlayHotkey = (
  left: OverlayHotkeyBinding,
  right: OverlayHotkeyBinding
) => left.modifier === right.modifier && left.key === right.key;

export const isOverlaySameAsScreenshotHotkey = (
  overlay: OverlayHotkeyBinding,
  screenshot: ScreenshotHotkeyBinding
) =>
  overlay.key === screenshot.key &&
  !screenshot.ctrl &&
  screenshot.alt === (overlay.modifier === "alt") &&
  screenshot.shift === (overlay.modifier === "shift");

export const formatOverlayHotkey = (binding: OverlayHotkeyBinding) =>
  formatScreenshotHotkey({
    key: binding.key,
    ctrl: false,
    alt: binding.modifier === "alt",
    shift: binding.modifier === "shift",
  });
