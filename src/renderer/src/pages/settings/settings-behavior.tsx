import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField, ProtonPathPicker } from "@renderer/components";
import { useAppSelector } from "@renderer/hooks";
import { settingsContext } from "@renderer/context";
import "./settings-behavior.scss";
import { QuestionIcon } from "@primer/octicons-react";
import type { ProtonVersion } from "@types";

export function SettingsBehavior() {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [showRunAtStartup, setShowRunAtStartup] = useState(false);
  const [protonVersions, setProtonVersions] = useState<ProtonVersion[]>([]);
  const [protonVersionsLoaded, setProtonVersionsLoaded] = useState(false);
  const [selectedDefaultProtonPath, setSelectedDefaultProtonPath] =
    useState("");

  const { updateUserPreferences } = useContext(settingsContext);

  const [form, setForm] = useState({
    preferQuitInsteadOfHiding: false,
    runAtStartup: false,
    startMinimized: false,
    launchToLibraryPage: false,
    disableNsfwAlert: false,
    enableAutoInstall: false,
    seedAfterDownloadComplete: false,
    showHiddenAchievementsDescription: false,
    showDownloadSpeedInMegabytes: false,
    extractFilesByDefault: true,
    enableSteamAchievements: false,
    autoplayGameTrailers: true,
    hideToTrayOnGameStart: false,
    enableNewDownloadOptionsBadges: true,
    createStartMenuShortcut: true,
  });

  const { t } = useTranslation("settings");
  const { t: tGameDetails } = useTranslation("game_details");

  useEffect(() => {
    if (userPreferences) {
      setForm({
        preferQuitInsteadOfHiding:
          userPreferences.preferQuitInsteadOfHiding ?? false,
        runAtStartup: userPreferences.runAtStartup ?? false,
        startMinimized: userPreferences.startMinimized ?? false,
        launchToLibraryPage: userPreferences.launchToLibraryPage ?? false,
        disableNsfwAlert: userPreferences.disableNsfwAlert ?? false,
        enableAutoInstall: userPreferences.enableAutoInstall ?? false,
        seedAfterDownloadComplete:
          userPreferences.seedAfterDownloadComplete ?? false,
        showHiddenAchievementsDescription:
          userPreferences.showHiddenAchievementsDescription ?? false,
        showDownloadSpeedInMegabytes:
          userPreferences.showDownloadSpeedInMegabytes ?? false,
        extractFilesByDefault: userPreferences.extractFilesByDefault ?? true,
        enableSteamAchievements:
          userPreferences.enableSteamAchievements ?? false,
        autoplayGameTrailers: userPreferences.autoplayGameTrailers ?? true,
        hideToTrayOnGameStart: userPreferences.hideToTrayOnGameStart ?? false,
        enableNewDownloadOptionsBadges:
          userPreferences.enableNewDownloadOptionsBadges ?? true,
        createStartMenuShortcut:
          userPreferences.createStartMenuShortcut ?? true,
      });

      setSelectedDefaultProtonPath(userPreferences.defaultProtonPath ?? "");
    }
  }, [userPreferences]);

  useEffect(() => {
    if (window.electron.platform !== "linux") return;

    window.electron
      .getInstalledProtonVersions()
      .then(setProtonVersions)
      .catch(() => setProtonVersions([]))
      .finally(() => setProtonVersionsLoaded(true));
  }, []);

  useEffect(() => {
    if (!protonVersionsLoaded || !selectedDefaultProtonPath) return;

    const hasSelectedVersion = protonVersions.some(
      (version) => version.path === selectedDefaultProtonPath
    );

    if (!hasSelectedVersion) {
      setSelectedDefaultProtonPath("");
    }
  }, [protonVersions, protonVersionsLoaded, selectedDefaultProtonPath]);

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

      <CheckboxField
        label={t("hide_to_tray_on_game_start")}
        checked={form.hideToTrayOnGameStart}
        onChange={() =>
          handleChange({
            hideToTrayOnGameStart: !form.hideToTrayOnGameStart,
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

      <CheckboxField
        label={t("launch_hydra_in_library_page")}
        checked={form.launchToLibraryPage}
        onChange={() =>
          handleChange({ launchToLibraryPage: !form.launchToLibraryPage })
        }
      />

      {window.electron.platform === "linux" && (
        <>
          <CheckboxField
            label={t("enable_auto_install")}
            checked={form.enableAutoInstall}
            onChange={() =>
              handleChange({ enableAutoInstall: !form.enableAutoInstall })
            }
          />

          <div className="settings-behavior__proton-section">
            <h3 className="settings-behavior__proton-title">
              {t("default_proton_version")}
            </h3>
            <p className="settings-behavior__proton-description">
              {t("default_proton_version_description")}
            </p>

            <ProtonPathPicker
              versions={protonVersions}
              selectedPath={selectedDefaultProtonPath}
              onChange={(value) => {
                setSelectedDefaultProtonPath(value);
                updateUserPreferences({ defaultProtonPath: value || null });
              }}
              radioName="default-proton-version"
              autoLabel={tGameDetails("proton_version_auto")}
              autoSourceDescription={tGameDetails("proton_source_umu_default")}
              steamSourceDescription={tGameDetails("proton_source_steam")}
              compatibilityToolsSourceDescription={tGameDetails(
                "proton_source_compatibility_tools"
              )}
            />
          </div>
        </>
      )}

      <CheckboxField
        label={t("autoplay_trailers_on_game_page")}
        checked={form.autoplayGameTrailers}
        onChange={() =>
          handleChange({ autoplayGameTrailers: !form.autoplayGameTrailers })
        }
      />

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

      <div className={`settings-behavior__checkbox-container--with-tooltip`}>
        <CheckboxField
          label={t("enable_steam_achievements")}
          checked={form.enableSteamAchievements}
          onChange={() =>
            handleChange({
              enableSteamAchievements: !form.enableSteamAchievements,
            })
          }
        />

        <small
          className="settings-behavior__checkbox-container--tooltip"
          data-open-article="steam-achievements"
        >
          <QuestionIcon size={12} />
        </small>
      </div>

      <CheckboxField
        label={t("enable_new_download_options_badges")}
        checked={form.enableNewDownloadOptionsBadges}
        onChange={() =>
          handleChange({
            enableNewDownloadOptionsBadges:
              !form.enableNewDownloadOptionsBadges,
          })
        }
      />

      {window.electron.platform === "win32" && (
        <CheckboxField
          label={t("create_start_menu_shortcut_on_download")}
          checked={form.createStartMenuShortcut}
          onChange={() =>
            handleChange({
              createStartMenuShortcut: !form.createStartMenuShortcut,
            })
          }
        />
      )}
    </>
  );
}
