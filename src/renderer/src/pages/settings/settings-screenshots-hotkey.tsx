import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import { DEFAULT_SCREENSHOT_HOTKEY, formatScreenshotHotkey } from "@shared";
import type { ScreenshotHotkeyBinding } from "@types";

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
  "AltGraph",
]);

const FORBIDDEN_HOTKEY_KEYS = new Set([
  "Escape",
  "Tab",
  "Enter",
  "NumpadEnter",
  "Space",
  "Backspace",
  "CapsLock",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
  "ContextMenu",
]);

export const screenshotHotkeyKeyFromCode = (code: string) => {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];

  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];

  return code;
};

export const isScreenshotHotkeyAllowed = (binding: ScreenshotHotkeyBinding) => {
  if (!binding.key || FORBIDDEN_HOTKEY_KEYS.has(binding.key)) return false;

  const isAlphanumeric = /^[A-Z0-9]$/.test(binding.key);
  if (isAlphanumeric && !binding.ctrl && !binding.alt) return false;

  return true;
};

const isSameHotkey = (
  left: ScreenshotHotkeyBinding,
  right: ScreenshotHotkeyBinding
) =>
  left.key === right.key &&
  left.ctrl === right.ctrl &&
  left.alt === right.alt &&
  left.shift === right.shift;

export interface SettingsScreenshotsHotkeyProps {
  binding: ScreenshotHotkeyBinding;
  disabled: boolean;
  onChange: (binding: ScreenshotHotkeyBinding) => void;
}

export function SettingsScreenshotsHotkey({
  binding,
  disabled,
  onChange,
}: Readonly<SettingsScreenshotsHotkeyProps>) {
  const { t } = useTranslation("settings");
  const [isRecording, setIsRecording] = useState(false);
  const [isInvalid, setIsInvalid] = useState(false);

  useEffect(() => {
    if (disabled) setIsRecording(false);
  }, [disabled]);

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.repeat || MODIFIER_CODES.has(event.code)) return;

      if (event.code === "Escape") {
        setIsRecording(false);
        return;
      }

      const nextBinding: ScreenshotHotkeyBinding = {
        key: screenshotHotkeyKeyFromCode(event.code),
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
      };

      setIsRecording(false);

      if (!isScreenshotHotkeyAllowed(nextBinding)) {
        setIsInvalid(true);
        return;
      }

      onChange(nextBinding);
    };

    window.addEventListener("keydown", handleKeyDown, true);

    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isRecording, onChange]);

  const handleToggleRecording = () => {
    setIsInvalid(false);
    setIsRecording((previous) => !previous);
  };

  const isDefault = isSameHotkey(binding, DEFAULT_SCREENSHOT_HOTKEY);

  return (
    <div className="settings-screenshots__field">
      <span className="settings-screenshots__field-label">
        {t("screenshots_hotkey")}
      </span>

      <div className="settings-screenshots__hotkey-row">
        <kbd
          className={`settings-screenshots__keycap ${
            isRecording ? "settings-screenshots__keycap--recording" : ""
          }`}
        >
          {isRecording
            ? t("screenshots_hotkey_recording")
            : formatScreenshotHotkey(binding)}
        </kbd>

        <Button
          theme="outline"
          size="small"
          disabled={disabled}
          aria-pressed={isRecording}
          onClick={handleToggleRecording}
        >
          {isRecording
            ? t("screenshots_hotkey_recording")
            : t("screenshots_hotkey_change")}
        </Button>

        {!isDefault && (
          <Button
            theme="outline"
            size="small"
            disabled={disabled || isRecording}
            onClick={() => {
              setIsInvalid(false);
              onChange(DEFAULT_SCREENSHOT_HOTKEY);
            }}
          >
            {t("screenshots_hotkey_reset")}
          </Button>
        )}
      </div>

      {isInvalid && (
        <small className="settings-screenshots__error" role="alert">
          {t("screenshots_hotkey_invalid")}
        </small>
      )}
    </div>
  );
}
