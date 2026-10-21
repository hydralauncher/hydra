import { useTranslation } from "react-i18next";
import cn from "classnames";

import { Button } from "@renderer/components";
import {
  DEFAULT_SCREENSHOT_GAMEPAD_COMBO,
  SCREENSHOT_GAMEPAD_BUTTONS,
  SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS,
  SCREENSHOT_GAMEPAD_COMBO_MIN_BUTTONS,
  isSameScreenshotGamepadCombo,
} from "@shared";
import type { ScreenshotGamepadButton } from "@types";

export const toggleScreenshotGamepadButton = (
  combo: ScreenshotGamepadButton[],
  button: ScreenshotGamepadButton
): ScreenshotGamepadButton[] | null => {
  const isSelected = combo.includes(button);

  if (isSelected && combo.length <= SCREENSHOT_GAMEPAD_COMBO_MIN_BUTTONS) {
    return null;
  }

  if (!isSelected && combo.length >= SCREENSHOT_GAMEPAD_COMBO_MAX_BUTTONS) {
    return null;
  }

  const nextSelection = isSelected
    ? combo.filter((selected) => selected !== button)
    : [...combo, button];

  return SCREENSHOT_GAMEPAD_BUTTONS.filter((candidate) =>
    nextSelection.includes(candidate)
  );
};

export interface SettingsScreenshotsGamepadProps {
  combo: ScreenshotGamepadButton[];
  disabled: boolean;
  onChange: (combo: ScreenshotGamepadButton[]) => void;
}

export function SettingsScreenshotsGamepad({
  combo,
  disabled,
  onChange,
}: Readonly<SettingsScreenshotsGamepadProps>) {
  const { t } = useTranslation("settings");

  const handleToggle = (button: ScreenshotGamepadButton) => {
    const nextCombo = toggleScreenshotGamepadButton(combo, button);
    if (nextCombo) onChange(nextCombo);
  };

  return (
    <div
      className={cn("settings-screenshots__field", {
        "settings-screenshots__field--disabled": disabled,
      })}
    >
      <div className="settings-screenshots__field-header">
        <span className="settings-screenshots__field-label">
          {t("screenshots_gamepad_combo")}
        </span>

        {!isSameScreenshotGamepadCombo(
          combo,
          DEFAULT_SCREENSHOT_GAMEPAD_COMBO
        ) && (
          <Button
            theme="outline"
            size="small"
            disabled={disabled}
            onClick={() => onChange([...DEFAULT_SCREENSHOT_GAMEPAD_COMBO])}
          >
            {t("screenshots_gamepad_reset")}
          </Button>
        )}
      </div>

      <small className="settings-screenshots__hint">
        {t("screenshots_gamepad_combo_hint")}
      </small>

      <fieldset
        className="settings-screenshots__chips"
        aria-label={t("screenshots_gamepad_combo")}
      >
        {SCREENSHOT_GAMEPAD_BUTTONS.map((button) => {
          const isSelected = combo.includes(button);

          return (
            <button
              key={button}
              type="button"
              className={cn("settings-screenshots__chip", {
                "settings-screenshots__chip--selected": isSelected,
              })}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => handleToggle(button)}
            >
              {t(`screenshots_gamepad_button_${button}`)}
            </button>
          );
        })}
      </fieldset>
    </div>
  );
}
