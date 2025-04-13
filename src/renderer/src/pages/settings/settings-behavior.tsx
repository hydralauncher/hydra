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
    enableAutoInstall: false,
    seedAfterDownloadComplete: false,
    showHiddenAchievementsDescription: false,
    showDownloadSpeedInMegabytes: false,
    extractFilesByDefault: false,
  });

  const { t } = useTranslation("settings");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        preferQuitInsteadOfHiding:
          userPreferences.preferQuitInsteadOfHiding ?? false,
        runAtStartup: userPreferences.runAtStartup ?? false,
        startMinimized: userPreferences.startMinimized ?? false,
        disableNsfwAlert: userPreferences.disableNsfwAlert ?? false,
        enableAutoInstall: userPreferences.enableAutoInstall ?? false,
        seedAfterDownloadComplete:
          userPreferences.seedAfterDownloadComplete ?? false,
        showHiddenAchievementsDescription:
          userPreferences.showHiddenAchievementsDescription ?? false,
        showDownloadSpeedInMegabytes:
          userPreferences.showDownloadSpeedInMegabytes ?? false,
        extractFilesByDefault: userPreferences.extractFilesByDefault ?? false,
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
            style={{ cursor: form.runAtStartup ? "pointer" : "not-allowed" }}
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

      {window.electron.platform === "linux" && (
        <CheckboxField
          label={t("enable_auto_install")}
          checked={form.enableAutoInstall}
          onChange={() =>
            handleChange({ enableAutoInstall: !form.enableAutoInstall })
          }
        />
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

      <CheckboxField
        label={t("show_download_speed_in_megabytes")}
        checked={form.showDownloadSpeedInMegabytes}
        onChange={() =>
          handleChange({
            showDownloadSpeedInMegabytes: !form.showDownloadSpeedInMegabytes,
          })
        }
      />

      <CheckboxField
        label={t("extract_files_by_default")}
        checked={form.extractFilesByDefault}
        onChange={() =>
          handleChange({
            extractFilesByDefault: !form.extractFilesByDefault,
          })
        }
      />
    </>
  );
}
