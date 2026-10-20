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
  borderFlashEnabled: boolean;
  askToUploadAfterGame: boolean;
  defaultVisibility: ProfileVisibility;
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
  borderFlashEnabled: preferences?.screenshotBorderFlashEnabled ?? true,
  askToUploadAfterGame: preferences?.screenshotAskToUploadAfterGame ?? true,
  defaultVisibility: preferences?.screenshotDefaultVisibility ?? "PUBLIC",
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
