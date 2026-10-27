import { useEffect, useState } from "react";
import cn from "classnames";
import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import {
  DEFAULT_SCREENSHOT_HOTKEY,
  formatScreenshotHotkey,
  isSameScreenshotHotkey,
  validateScreenshotHotkey,
  type ScreenshotHotkeyError,
} from "@shared";
import type { ScreenshotHotkeyBinding } from "@types";

const PRINT_SCREEN_CODE = "PrintScreen";

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
  const { t: tInput } = useTranslation("screenshots_input");
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<ScreenshotHotkeyError | null>(null);

  useEffect(() => {
    if (disabled) setIsRecording(false);
  }, [disabled]);

  useEffect(() => {
    if (!isRecording) return;

    const recordKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.repeat || MODIFIER_CODES.has(event.code)) return;

      if (event.code === "Escape") {
        setIsRecording(false);
        return;
      }

      const nextBinding: ScreenshotHotkeyBinding = {
        key: event.code,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
      };

      setIsRecording(false);

      const validation = validateScreenshotHotkey({
        ...nextBinding,
        meta: event.metaKey,
      });
      if (!validation.valid) {
        setError(validation.error);
        return;
      }

      onChange(nextBinding);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== PRINT_SCREEN_CODE) recordKey(event);
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === PRINT_SCREEN_CODE) recordKey(event);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
    };
  }, [isRecording, onChange]);

  const handleToggleRecording = () => {
    setError(null);
    setIsRecording((previous) => !previous);
  };

  const isDefault = isSameScreenshotHotkey(binding, DEFAULT_SCREENSHOT_HOTKEY);

  return (
    <div className="settings-screenshots__field">
      <span className="settings-screenshots__field-label">
        {t("screenshots_hotkey")}
      </span>

      <div className="settings-screenshots__hotkey-row">
        <button
          type="button"
          className={cn("settings-screenshots__keycap", {
            "settings-screenshots__keycap--recording": isRecording,
          })}
          disabled={disabled}
          aria-pressed={isRecording}
          aria-label={
            isRecording
              ? t("screenshots_hotkey_recording")
              : t("screenshots_hotkey_change_label", {
                  key: formatScreenshotHotkey(binding),
                })
          }
          onClick={handleToggleRecording}
        >
          <kbd>
            {isRecording
              ? t("screenshots_hotkey_recording")
              : formatScreenshotHotkey(binding)}
          </kbd>
        </button>

        {!isDefault && (
          <Button
            theme="outline"
            size="small"
            disabled={disabled || isRecording}
            onClick={() => {
              setError(null);
              onChange({ ...DEFAULT_SCREENSHOT_HOTKEY });
            }}
          >
            {t("screenshots_hotkey_reset")}
          </Button>
        )}
      </div>

      {error && (
        <small className="settings-screenshots__error" role="alert">
          {tInput(error)}
        </small>
      )}
    </div>
  );
}
