import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField } from "@renderer/components";
import { useAppSelector } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import "./settings-behavior.scss";

export function SettingsBehavior() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [showRunAtStartup, setShowRunAtStartup] = useState(false);

  const { updateUserPreferences } = useContext(settingsContext);

  const [form, setForm] = useState({
    preferQuitInsteadOfHiding: false,
    runAtStartup: false,
    startMinimized: false,
    disableNsfwAlert: false,
    seedAfterDownloadComplete: false,
    showHiddenAchievementsDescription: false,
  });

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        preferQuitInsteadOfHiding: userPreferences.preferQuitInsteadOfHiding,
        runAtStartup: userPreferences.runAtStartup,
        startMinimized: userPreferences.startMinimized,
        disableNsfwAlert: userPreferences.disableNsfwAlert,
        seedAfterDownloadComplete: userPreferences.seedAfterDownloadComplete,
        showHiddenAchievementsDescription:
          userPreferences.showHiddenAchievementsDescription,
      });
    }
  }, [userPreferences]);

  useEffect(() => {
    window.electron.isPortableVersion().then((isPortableVersion) => {
      setShowRunAtStartup(!isPortableVersion);
    });
  }, []);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  return (
    <>
      <CheckboxField
        label={t("quit_app_instead_hiding")}
        checked={form.preferQuitInsteadOfHiding}
        onChange={() =>
          handleChange({
            preferQuitInsteadOfHiding: !form.preferQuitInsteadOfHiding,
          })
        }
      />

      {showRunAtStartup && (
        <CheckboxField
          label={t("launch_with_system")}
          onChange={() => {
            handleChange({ runAtStartup: !form.runAtStartup });
            window.electron.autoLaunch({
              enabled: !form.runAtStartup,
              minimized: form.startMinimized,
            });
          }}
          checked={form.runAtStartup}
        />
      )}

      {showRunAtStartup && (
        <div
          className={`settings-behavior__checkbox-container ${form.runAtStartup ? "settings-behavior__checkbox-container--enabled" : ""}`}
        >
          <CheckboxField
            label={t("launch_minimized")}
            checked={form.runAtStartup && form.startMinimized}
            disabled={!form.runAtStartup}
            onChange={() => {
              handleChange({ startMinimized: !form.startMinimized });
              window.electron.autoLaunch({
                minimized: !form.startMinimized,
                enabled: form.runAtStartup,
              });
            }}
          />
        </div>
      )}

      <CheckboxField
        label={t("disable_nsfw_alert")}
        checked={form.disableNsfwAlert}
        onChange={() =>
          handleChange({ disableNsfwAlert: !form.disableNsfwAlert })
        }
      />

      <CheckboxField
        label={t("seed_after_download_complete")}
        checked={form.seedAfterDownloadComplete}
        onChange={() =>
          handleChange({
            seedAfterDownloadComplete: !form.seedAfterDownloadComplete,
          })
        }
      />

      <CheckboxField
        label={t("show_hidden_achievement_description")}
        checked={form.showHiddenAchievementsDescription}
        onChange={() =>
          handleChange({
            showHiddenAchievementsDescription:
              !form.showHiddenAchievementsDescription,
          })
        }
      />
    </>
  );
}
