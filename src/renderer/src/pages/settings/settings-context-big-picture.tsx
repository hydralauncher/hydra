import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField, SelectField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { BigPictureDiagnosticsPosition, UserPreferences } from "@types";

const buildForm = (preferences: UserPreferences | null) => ({
  launchInBigPicture: preferences?.launchInBigPicture ?? false,
  bigPictureLaunchToLibraryPage:
    preferences?.bigPictureLaunchToLibraryPage ??
    preferences?.launchToLibraryPage ??
    false,
  bigPictureSoundsEnabled: preferences?.bigPictureSoundsEnabled ?? true,
  bigPictureVirtualKeyboardEnabled:
    preferences?.bigPictureVirtualKeyboardEnabled ?? true,
  bigPictureDiagnosticsEnabled:
    preferences?.bigPictureDiagnosticsEnabled ?? false,
  bigPictureDiagnosticsPosition: (preferences?.bigPictureDiagnosticsPosition ??
    "bottom-center") as BigPictureDiagnosticsPosition,
});

export function SettingsContextBigPicture() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState(() => buildForm(userPreferences));

  useEffect(() => {
    if (!userPreferences) return;

    setForm(buildForm(userPreferences));
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

        <CheckboxField
          label={t("launch_big_picture_in_library_page")}
          checked={form.bigPictureLaunchToLibraryPage}
          onChange={() =>
            handleChange({
              bigPictureLaunchToLibraryPage:
                !form.bigPictureLaunchToLibraryPage,
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
