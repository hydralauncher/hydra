import type {
  ProfileVisibility,
  ScreenshotGamepadButton,
  ScreenshotHotkeyBinding,
  UserPreferences,
} from "@types";

export const DEFAULT_SCREENSHOT_HOTKEY: ScreenshotHotkeyBinding = {
  key: "F10",
  ctrl: false,
  alt: false,
  shift: false,
};

export const DEFAULT_SCREENSHOT_GAMEPAD_COMBO: ScreenshotGamepadButton[] = [
  "back",
  "rb",
];

export const SCREENSHOT_GAMEPAD_BUTTONS: ScreenshotGamepadButton[] = [
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
  hotkey: preferences?.screenshotHotkey ?? DEFAULT_SCREENSHOT_HOTKEY,
  gamepadEnabled: preferences?.screenshotGamepadEnabled ?? true,
  gamepadCombo: preferences?.screenshotGamepadCombo?.length
    ? preferences.screenshotGamepadCombo
    : DEFAULT_SCREENSHOT_GAMEPAD_COMBO,
  captureSoundEnabled: preferences?.screenshotCaptureSoundEnabled ?? true,
  toastEnabled: preferences?.screenshotToastEnabled ?? true,
  borderFlashEnabled: preferences?.screenshotBorderFlashEnabled ?? true,
  askToUploadAfterGame: preferences?.screenshotAskToUploadAfterGame ?? true,
  defaultVisibility: preferences?.screenshotDefaultVisibility ?? "PUBLIC",
});

export const formatScreenshotHotkey = (binding: ScreenshotHotkeyBinding) =>
  [
    binding.ctrl ? "Ctrl" : null,
    binding.alt ? "Alt" : null,
    binding.shift ? "Shift" : null,
    binding.key,
  ]
    .filter((part): part is string => part !== null)
    .join(" + ");
