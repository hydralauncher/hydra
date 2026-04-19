import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { ToggleSwitch } from "@renderer/components";
import { useAppSelector } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import "./settings-behavior.scss";
import { QuestionIcon } from "@primer/octicons-react";

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
    extractFilesByDefault: true,
    autoDeleteInstallerAfterExtraction: false,
    enableSteamAchievements: false,
    autoplayGameTrailers: true,
    hideToTrayOnGameStart: false,
    enableNewDownloadOptionsBadges: true,
    createStartMenuShortcut: true,
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
        extractFilesByDefault: userPreferences.extractFilesByDefault ?? true,
        autoDeleteInstallerAfterExtraction:
          userPreferences.autoDeleteInstallerAfterExtraction ?? false,
        enableSteamAchievements:
          userPreferences.enableSteamAchievements ?? false,
        autoplayGameTrailers: userPreferences.autoplayGameTrailers ?? true,
        hideToTrayOnGameStart: userPreferences.hideToTrayOnGameStart ?? false,
        enableNewDownloadOptionsBadges:
          userPreferences.enableNewDownloadOptionsBadges ?? true,
        createStartMenuShortcut:
          userPreferences.createStartMenuShortcut ?? true,
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
    <div className="settings-behavior">
      {/* Application */}
      <div className="settings-behavior__section">
        <div className="settings-behavior__section-header">
          <h3 className="settings-behavior__section-title">
            {t("behavior_section_application")}
          </h3>
          <p className="settings-behavior__section-description">
            {t("behavior_section_application_description")}
          </p>
        </div>

        <div className="settings-behavior__toggles">
          <ToggleSwitch
            label={t("quit_app_instead_hiding")}
            description={t("quit_app_instead_hiding_desc")}
            checked={form.preferQuitInsteadOfHiding}
            onChange={() =>
              handleChange({
                preferQuitInsteadOfHiding: !form.preferQuitInsteadOfHiding,
              })
            }
          />

          <ToggleSwitch
            label={t("hide_to_tray_on_game_start")}
            description={t("hide_to_tray_on_game_start_desc")}
            checked={form.hideToTrayOnGameStart}
            onChange={() =>
              handleChange({
                hideToTrayOnGameStart: !form.hideToTrayOnGameStart,
              })
            }
          />

          {showRunAtStartup && (
            <ToggleSwitch
              label={t("launch_with_system")}
              description={t("launch_with_system_desc")}
              checked={form.runAtStartup}
              onChange={() => {
                handleChange({ runAtStartup: !form.runAtStartup });
                window.electron.autoLaunch({
                  enabled: !form.runAtStartup,
                  minimized: form.startMinimized,
                });
              }}
            />
          )}

          {showRunAtStartup && (
            <ToggleSwitch
              label={t("launch_minimized")}
              description={t("launch_minimized_desc")}
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
          )}
        </div>
      </div>

      {/* Downloads */}
      <div className="settings-behavior__section">
        <div className="settings-behavior__section-header">
          <h3 className="settings-behavior__section-title">
            {t("behavior_section_downloads")}
          </h3>
          <p className="settings-behavior__section-description">
            {t("behavior_section_downloads_description")}
          </p>
        </div>

        <div className="settings-behavior__toggles">
          <ToggleSwitch
            label={t("seed_after_download_complete")}
            description={t("seed_after_download_complete_desc")}
            checked={form.seedAfterDownloadComplete}
            onChange={() =>
              handleChange({
                seedAfterDownloadComplete: !form.seedAfterDownloadComplete,
              })
            }
          />

          <ToggleSwitch
            label={t("extract_files_by_default")}
            description={t("extract_files_by_default_desc")}
            checked={form.extractFilesByDefault}
            onChange={() =>
              handleChange({
                extractFilesByDefault: !form.extractFilesByDefault,
              })
            }
          />

          <ToggleSwitch
            label={t("auto_delete_installer_after_extraction")}
            description={t("auto_delete_installer_after_extraction_desc")}
            checked={form.autoDeleteInstallerAfterExtraction}
            onChange={() =>
              handleChange({
                autoDeleteInstallerAfterExtraction:
                  !form.autoDeleteInstallerAfterExtraction,
              })
            }
          />

          <ToggleSwitch
            label={t("show_download_speed_in_megabytes")}
            description={t("show_download_speed_in_megabytes_desc")}
            checked={form.showDownloadSpeedInMegabytes}
            onChange={() =>
              handleChange({
                showDownloadSpeedInMegabytes:
                  !form.showDownloadSpeedInMegabytes,
              })
            }
          />

          {window.electron.platform === "linux" && (
            <ToggleSwitch
              label={t("enable_auto_install")}
              description={t("enable_auto_install_desc")}
              checked={form.enableAutoInstall}
              onChange={() =>
                handleChange({ enableAutoInstall: !form.enableAutoInstall })
              }
            />
          )}

          {window.electron.platform === "win32" && (
            <ToggleSwitch
              label={t("create_start_menu_shortcut_on_download")}
              description={t("create_start_menu_shortcut_on_download_desc")}
              checked={form.createStartMenuShortcut}
              onChange={() =>
                handleChange({
                  createStartMenuShortcut: !form.createStartMenuShortcut,
                })
              }
            />
          )}
        </div>
      </div>

      {/* Content & Display */}
      <div className="settings-behavior__section">
        <div className="settings-behavior__section-header">
          <h3 className="settings-behavior__section-title">
            {t("behavior_section_content")}
          </h3>
          <p className="settings-behavior__section-description">
            {t("behavior_section_content_description")}
          </p>
        </div>

        <div className="settings-behavior__toggles">
          <ToggleSwitch
            label={t("autoplay_trailers_on_game_page")}
            description={t("autoplay_trailers_on_game_page_desc")}
            checked={form.autoplayGameTrailers}
            onChange={() =>
              handleChange({
                autoplayGameTrailers: !form.autoplayGameTrailers,
              })
            }
          />

          <ToggleSwitch
            label={t("disable_nsfw_alert")}
            description={t("disable_nsfw_alert_desc")}
            checked={form.disableNsfwAlert}
            onChange={() =>
              handleChange({ disableNsfwAlert: !form.disableNsfwAlert })
            }
          />

          <ToggleSwitch
            label={t("enable_new_download_options_badges")}
            description={t("enable_new_download_options_badges_desc")}
            checked={form.enableNewDownloadOptionsBadges}
            onChange={() =>
              handleChange({
                enableNewDownloadOptionsBadges:
                  !form.enableNewDownloadOptionsBadges,
              })
            }
          />
        </div>
      </div>

      {/* Achievements */}
      <div className="settings-behavior__section">
        <div className="settings-behavior__section-header">
          <h3 className="settings-behavior__section-title">
            {t("behavior_section_achievements")}
          </h3>
          <p className="settings-behavior__section-description">
            {t("behavior_section_achievements_description")}
          </p>
        </div>

        <div className="settings-behavior__toggles">
          <ToggleSwitch
            label={t("show_hidden_achievement_description")}
            description={t("show_hidden_achievement_description_desc")}
            checked={form.showHiddenAchievementsDescription}
            onChange={() =>
              handleChange({
                showHiddenAchievementsDescription:
                  !form.showHiddenAchievementsDescription,
              })
            }
          />

          <div className="settings-behavior__toggle-with-help">
            <ToggleSwitch
              label={t("enable_steam_achievements")}
              description={t("enable_steam_achievements_desc")}
              checked={form.enableSteamAchievements}
              onChange={() =>
                handleChange({
                  enableSteamAchievements: !form.enableSteamAchievements,
                })
              }
            />
            <button
              type="button"
              className="settings-behavior__help-button"
              data-open-article="steam-achievements"
            >
              <QuestionIcon size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
