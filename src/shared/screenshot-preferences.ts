import type {
  ProfileVisibility,
  ScreenshotGamepadButton,
  ScreenshotHotkeyBinding,
  UserPreferences,
} from "@types";
import {
  normalizeScreenshotGamepadCombo,
  normalizeScreenshotHotkey,
} from "./screenshot-input";

export const SCREENSHOT_VISIBILITY_OPTIONS: ProfileVisibility[] = [
  "PUBLIC",
  "FRIENDS",
  "PRIVATE",
];

export const SCREENSHOT_CUSTOM_GAME_TITLE_MAX_LENGTH = 100;

export interface ResolvedScreenshotPreferences {
  enabled: boolean;
  hotkey: ScreenshotHotkeyBinding;
  gamepadEnabled: boolean;
  gamepadCombo: ScreenshotGamepadButton[];
  captureSoundEnabled: boolean;
  toastEnabled: boolean;
  defaultVisibility: ProfileVisibility;
  showSensitive: boolean;
}

export const resolveScreenshotPreferences = (
  preferences: UserPreferences | null | undefined
): ResolvedScreenshotPreferences => ({
  enabled: preferences?.screenshotsEnabled ?? true,
  hotkey: normalizeScreenshotHotkey(preferences?.screenshotHotkey),
  gamepadEnabled: preferences?.screenshotGamepadEnabled ?? true,
  gamepadCombo: normalizeScreenshotGamepadCombo(
    preferences?.screenshotGamepadCombo
  ),
  captureSoundEnabled: preferences?.screenshotCaptureSoundEnabled ?? true,
  toastEnabled: preferences?.screenshotToastEnabled ?? true,
  defaultVisibility: preferences?.screenshotDefaultVisibility ?? "PUBLIC",
  showSensitive: preferences?.showSensitiveScreenshots ?? false,
});

export const formatScreenshotHotkeyKey = (key: string) =>
  key.replace(/^(Key|Digit)(?=.)/, "");

export const formatScreenshotHotkey = (binding: ScreenshotHotkeyBinding) =>
  [
    binding.ctrl ? "Ctrl" : null,
    binding.alt ? "Alt" : null,
    binding.shift ? "Shift" : null,
    formatScreenshotHotkeyKey(binding.key),
  ]
    .filter((part): part is string => part !== null)
    .join(" + ");

export const SCREENSHOT_DESCRIPTION_MAX_LENGTH = 200;

const DESCRIPTION_LINE_BREAKS = /[\r\n\u2028\u2029]+/g;

const stripControlCharacters = (value: string) =>
  Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && (code < 127 || code > 159);
    })
    .join("");

const TRAILING_HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

export const sanitizeScreenshotDescriptionInput = (value: string) =>
  stripControlCharacters(value.replaceAll(DESCRIPTION_LINE_BREAKS, " "))
    .slice(0, SCREENSHOT_DESCRIPTION_MAX_LENGTH)
    .replace(TRAILING_HIGH_SURROGATE, "");

export const normalizeScreenshotDescription = (
  value: string | null | undefined
) => {
  if (!value) return null;
  const normalized = sanitizeScreenshotDescriptionInput(value).trim();
  return normalized || null;
};
