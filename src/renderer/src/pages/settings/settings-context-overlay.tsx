import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";

import { Button, CheckboxField, SelectField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import { useScreenshotInputStatus } from "@renderer/hooks/use-screenshot-input-status";
import {
  DEFAULT_OVERLAY_HOTKEY,
  formatOverlayHotkey,
  isOverlaySameAsScreenshotHotkey,
  isSameOverlayHotkey,
  normalizeOverlayHotkey,
  normalizeScreenshotHotkey,
  validateOverlayHotkey,
  type OverlayHotkeyError,
} from "@shared";
import type {
  OverlayHotkeyBinding,
  OverlayHotkeyModifier,
  UserPreferences,
} from "@types";

import "./settings-context-overlay.scss";

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

type OverlayHotkeyFormError = OverlayHotkeyError | "hotkey_conflict";

interface OverlayForm {
  enabled: boolean;
  hotkey: OverlayHotkeyBinding;
}

const resolveOverlayForm = (
  preferences: UserPreferences | null | undefined
): OverlayForm => ({
  enabled: preferences?.overlayEnabled ?? true,
  hotkey: normalizeOverlayHotkey(preferences?.overlayHotkey),
});

const getHotkeyError = (
  binding: OverlayHotkeyBinding,
  screenshotHotkey: ReturnType<typeof normalizeScreenshotHotkey>
): OverlayHotkeyFormError | null => {
  const validation = validateOverlayHotkey(binding);
  if (!validation.valid) return validation.error;
  if (isOverlaySameAsScreenshotHotkey(binding, screenshotHotkey)) {
    return "hotkey_conflict";
  }
  return null;
};

export function SettingsContextOverlay() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);
  const inputStatus = useScreenshotInputStatus();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState<OverlayForm>(() =>
    resolveOverlayForm(userPreferences)
  );
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<OverlayHotkeyFormError | null>(null);

  useEffect(() => {
    if (!userPreferences) return;
    setForm(resolveOverlayForm(userPreferences));
  }, [userPreferences]);

  const screenshotHotkey = useMemo(
    () => normalizeScreenshotHotkey(userPreferences?.screenshotHotkey),
    [userPreferences?.screenshotHotkey]
  );

  useEffect(() => {
    setError(getHotkeyError(form.hotkey, screenshotHotkey));
  }, [form.hotkey, screenshotHotkey]);

  const persist = useCallback(
    (preferences: Partial<UserPreferences>) => {
      void updateUserPreferences(preferences);
    },
    [updateUserPreferences]
  );

  const saveHotkey = useCallback(
    (hotkey: OverlayHotkeyBinding) => {
      setForm((previous) => ({ ...previous, hotkey }));

      const nextError = getHotkeyError(hotkey, screenshotHotkey);
      setError(nextError);
      if (nextError) return;

      persist({ overlayHotkey: hotkey });
    },
    [persist, screenshotHotkey]
  );

  useEffect(() => {
    if (!isRecording) return;

    const recordKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.repeat || MODIFIER_CODES.has(event.code)) return;

      if (event.code === "Escape") {
        setIsRecording(false);
        setError(null);
        return;
      }

      setIsRecording(false);
      saveHotkey({ modifier: form.hotkey.modifier, key: event.code });
    };

    window.addEventListener("keydown", recordKey, true);

    return () => window.removeEventListener("keydown", recordKey, true);
  }, [form.hotkey.modifier, isRecording, saveHotkey]);

  const handleModifierChange = (modifier: OverlayHotkeyModifier) => {
    saveHotkey({ modifier, key: form.hotkey.key });
  };

  const handleToggleEnabled = () => {
    const enabled = !form.enabled;
    setForm((previous) => ({ ...previous, enabled }));
    persist({ overlayEnabled: enabled });
  };

  const handleReset = () => {
    setIsRecording(false);
    saveHotkey({ ...DEFAULT_OVERLAY_HOTKEY });
  };

  const modifierOptions: {
    key: OverlayHotkeyModifier;
    value: OverlayHotkeyModifier;
    label: string;
  }[] = [
    {
      key: "shift",
      value: "shift",
      label: t("overlay_modifier_shift"),
    },
    {
      key: "alt",
      value: "alt",
      label: t("overlay_modifier_alt"),
    },
  ];

  const errorMessage =
    error === "hotkey_conflict"
      ? t("overlay_hotkey_conflict")
      : error === "hotkey_reserved"
        ? t("overlay_hotkey_reserved")
        : error === "hotkey_unsupported_key"
          ? t("overlay_hotkey_unsupported")
          : null;

  const isDefault = isSameOverlayHotkey(form.hotkey, DEFAULT_OVERLAY_HOTKEY);

  const showInputUnavailable = inputStatus?.keyboardBackend === "unavailable";

  return (
    <div className="settings-context-panel settings-overlay">
      <div className="settings-context-panel__group">
        <h3>{t("overlay_category")}</h3>

        <CheckboxField
          label={t("overlay_enable")}
          checked={form.enabled}
          onChange={handleToggleEnabled}
        />

        <p className="settings-overlay__hint">{t("overlay_hint")}</p>

        <SelectField
          className="settings-overlay__select"
          label={t("overlay_modifier")}
          value={form.hotkey.modifier}
          options={modifierOptions}
          onChange={(event) => {
            const { value } = event.target;
            if (value !== "shift" && value !== "alt") return;
            handleModifierChange(value);
          }}
        />

        <div className="settings-overlay__field">
          <span className="settings-overlay__field-label">
            {t("overlay_hotkey")}
          </span>

          <div className="settings-overlay__hotkey-row">
            <button
              type="button"
              className={cn("settings-overlay__keycap", {
                "settings-overlay__keycap--recording": isRecording,
                "settings-overlay__keycap--invalid": Boolean(error),
              })}
              aria-pressed={isRecording}
              aria-label={
                isRecording
                  ? t("overlay_hotkey_record")
                  : t("overlay_hotkey_change_label", {
                      key: formatOverlayHotkey(form.hotkey),
                    })
              }
              onClick={() => {
                setError(null);
                setIsRecording((previous) => !previous);
              }}
            >
              <kbd>
                {isRecording
                  ? t("overlay_hotkey_record")
                  : formatOverlayHotkey(form.hotkey)}
              </kbd>
            </button>

            {!isDefault && (
              <Button
                theme="outline"
                size="small"
                disabled={isRecording}
                onClick={handleReset}
              >
                {t("overlay_hotkey_reset")}
              </Button>
            )}
          </div>

          {errorMessage && (
            <small className="settings-overlay__error" role="alert">
              {errorMessage}
            </small>
          )}
        </div>

        {showInputUnavailable && (
          <small className="settings-overlay__input-status">
            {t("overlay_input_unavailable")}
          </small>
        )}
      </div>
    </div>
  );
}
