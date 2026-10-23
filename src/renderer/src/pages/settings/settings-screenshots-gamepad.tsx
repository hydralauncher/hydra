import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { PlusIcon, XIcon } from "@primer/octicons-react";

import { Button, SelectField } from "@renderer/components";
import {
  DEFAULT_SCREENSHOT_GAMEPAD_COMBO,
  SCREENSHOT_GAMEPAD_BUTTONS,
  SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS,
  SCREENSHOT_GAMEPAD_COMBO_MIN_BUTTONS,
  isSameScreenshotGamepadCombo,
  validateScreenshotGamepadCombo,
} from "@shared";
import type { ScreenshotGamepadButton } from "@types";

export interface SettingsScreenshotsGamepadProps {
  combo: ScreenshotGamepadButton[];
  disabled: boolean;
  onChange: (combo: ScreenshotGamepadButton[]) => void;
}

const toGamepadButton = (value: string) =>
  SCREENSHOT_GAMEPAD_BUTTONS.find((button) => button === value) ?? null;

export function SettingsScreenshotsGamepad({
  combo,
  disabled,
  onChange,
}: Readonly<SettingsScreenshotsGamepadProps>) {
  const { t } = useTranslation("settings");
  const { t: tInput } = useTranslation("screenshots_input");
  const [draft, setDraft] = useState<ScreenshotGamepadButton[]>(combo);

  useEffect(() => {
    setDraft((current) =>
      isSameScreenshotGamepadCombo(current, combo) ? current : combo
    );
  }, [combo]);

  const validation = validateScreenshotGamepadCombo(draft);
  const hasDuplicates = new Set(draft).size !== draft.length;

  const updateDraft = (next: ScreenshotGamepadButton[]) => {
    setDraft(next);
    const nextValidation = validateScreenshotGamepadCombo(next);
    if (nextValidation.valid && new Set(next).size === next.length) {
      onChange(next);
    }
  };

  const handleSelect = (index: number, value: string) => {
    const button = toGamepadButton(value);
    if (!button) return;
    updateDraft(
      draft.map((current, position) => (position === index ? button : current))
    );
  };

  const handleAdd = () => {
    const unused = SCREENSHOT_GAMEPAD_BUTTONS.find(
      (button) => !draft.includes(button)
    );
    if (unused) updateDraft([...draft, unused]);
  };

  const handleRemove = (index: number) => {
    updateDraft(draft.filter((_, position) => position !== index));
  };

  const options = SCREENSHOT_GAMEPAD_BUTTONS.map((button) => ({
    key: button,
    value: button,
    label: t(`screenshots_gamepad_button_${button}`),
  }));

  const canAdd = draft.length < SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS;
  const errorMessage = (() => {
    if (hasDuplicates) return t("screenshots_gamepad_duplicate");
    if (!validation.valid) return tInput(validation.error);
    return null;
  })();

  return (
    <div
      className={cn("settings-screenshots__field", {
        "settings-screenshots__field--disabled": disabled,
      })}
    >
      <span className="settings-screenshots__field-label">
        {t("screenshots_gamepad_combo")}
      </span>

      <small className="settings-screenshots__hint">
        {t("screenshots_gamepad_combo_hint")}
      </small>

      <fieldset
        className="settings-screenshots__combo"
        aria-label={t("screenshots_gamepad_combo")}
      >
        {draft.map((button, index) => (
          <div
            key={`${index}-${button}`}
            className="settings-screenshots__combo-slot"
          >
            {index > 0 && (
              <span className="settings-screenshots__combo-plus" aria-hidden>
                +
              </span>
            )}
            <SelectField
              className="settings-screenshots__combo-select"
              value={button}
              options={options}
              disabled={disabled}
              onChange={(event) => handleSelect(index, event.target.value)}
            />
            {index >= SCREENSHOT_GAMEPAD_COMBO_MIN_BUTTONS && (
              <Button
                className="settings-screenshots__icon-action settings-screenshots__icon-action--field"
                theme="outline"
                size="small"
                disabled={disabled}
                tooltip={t("screenshots_gamepad_remove")}
                aria-label={t("screenshots_gamepad_remove")}
                onClick={() => handleRemove(index)}
              >
                <XIcon size={14} />
              </Button>
            )}
          </div>
        ))}

        {canAdd && (
          <Button
            className="settings-screenshots__icon-action settings-screenshots__icon-action--field"
            theme="outline"
            size="small"
            disabled={disabled}
            tooltip={t("screenshots_gamepad_add")}
            aria-label={t("screenshots_gamepad_add")}
            onClick={handleAdd}
          >
            <PlusIcon size={14} />
          </Button>
        )}

        {!isSameScreenshotGamepadCombo(
          draft,
          DEFAULT_SCREENSHOT_GAMEPAD_COMBO
        ) && (
          <Button
            className="settings-screenshots__combo-reset"
            theme="outline"
            size="small"
            disabled={disabled}
            onClick={() => updateDraft([...DEFAULT_SCREENSHOT_GAMEPAD_COMBO])}
          >
            {t("screenshots_gamepad_reset")}
          </Button>
        )}
      </fieldset>

      {errorMessage && (
        <small className="settings-screenshots__error" role="alert">
          {errorMessage}
        </small>
      )}
    </div>
  );
}
