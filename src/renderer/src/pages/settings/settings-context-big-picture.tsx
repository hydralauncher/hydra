import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField, SelectField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { BigPictureDiagnosticsPosition } from "@types";

export function SettingsContextBigPicture() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState({
    launchInBigPicture: false,
    bigPictureSoundsEnabled: true,
    bigPictureVirtualKeyboardEnabled: true,
    bigPictureDiagnosticsEnabled: false,
    bigPictureDiagnosticsPosition:
      "bottom-center" as BigPictureDiagnosticsPosition,
  });

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      launchInBigPicture: userPreferences.launchInBigPicture ?? false,
      bigPictureSoundsEnabled: userPreferences.bigPictureSoundsEnabled ?? true,
      bigPictureVirtualKeyboardEnabled:
        userPreferences.bigPictureVirtualKeyboardEnabled ?? true,
      bigPictureDiagnosticsEnabled:
        userPreferences.bigPictureDiagnosticsEnabled ?? false,
      bigPictureDiagnosticsPosition:
        userPreferences.bigPictureDiagnosticsPosition ?? "bottom-center",
    });
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  const diagnosticsPositionOptions = useMemo(
    () =>
      (
        [
          "top-left",
          "top-center",
          "top-right",
          "bottom-left",
          "bottom-center",
          "bottom-right",
        ] as BigPictureDiagnosticsPosition[]
      ).map((position) => ({
        key: position,
        value: position,
        label: t(position),
      })),
    [t]
  );

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("big_picture_startup")}</h3>

        <CheckboxField
          label={t("launch_hydra_in_big_picture")}
          checked={form.launchInBigPicture}
          onChange={() =>
            handleChange({
              launchInBigPicture: !form.launchInBigPicture,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("big_picture_audio")}</h3>

        <CheckboxField
          label={t("big_picture_enable_sounds")}
          checked={form.bigPictureSoundsEnabled}
          onChange={() =>
            handleChange({
              bigPictureSoundsEnabled: !form.bigPictureSoundsEnabled,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("big_picture_input")}</h3>

        <CheckboxField
          label={t("big_picture_enable_virtual_keyboard")}
          checked={form.bigPictureVirtualKeyboardEnabled}
          onChange={() =>
            handleChange({
              bigPictureVirtualKeyboardEnabled:
                !form.bigPictureVirtualKeyboardEnabled,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("big_picture_diagnostics")}</h3>

        <CheckboxField
          label={t("big_picture_enable_diagnostics")}
          checked={form.bigPictureDiagnosticsEnabled}
          onChange={() =>
            handleChange({
              bigPictureDiagnosticsEnabled: !form.bigPictureDiagnosticsEnabled,
            })
          }
        />

        <SelectField
          label={t("big_picture_diagnostics_position")}
          value={form.bigPictureDiagnosticsPosition}
          onChange={(e) =>
            handleChange({
              bigPictureDiagnosticsPosition: e.target
                .value as BigPictureDiagnosticsPosition,
            })
          }
          options={diagnosticsPositionOptions}
          disabled={!form.bigPictureDiagnosticsEnabled}
        />
      </div>
    </div>
  );
}
