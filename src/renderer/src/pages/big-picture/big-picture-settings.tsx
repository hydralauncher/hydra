import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "@renderer/hooks";
import { useBigPictureContext } from "./big-picture-app";
import languageResources from "@locales";
import { orderBy } from "lodash-es";
import {
  GlobeIcon,
  DownloadIcon,
  BellIcon,
  GearIcon,
  SignOutIcon,
  FileDirectoryIcon,
} from "@primer/octicons-react";
import "./big-picture-settings.scss";

interface SettingToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
}

function SettingToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: SettingToggleProps) {
  return (
    <button
      type="button"
      className={`bp-settings__row ${disabled ? "bp-settings__row--disabled" : ""}`}
      data-bp-focusable
      onClick={onChange}
      disabled={disabled}
    >
      <div className="bp-settings__row-text">
        <span className="bp-settings__row-label">{label}</span>
        <span className="bp-settings__row-description">{description}</span>
      </div>
      <span
        className={`bp-settings__toggle ${checked ? "bp-settings__toggle--on" : ""}`}
      >
        <span className="bp-settings__toggle-track">
          <span className="bp-settings__toggle-knob" />
        </span>
      </span>
    </button>
  );
}

export default function BigPictureSettings() {
  const { t, i18n } = useTranslation("big_picture");
  const { exitBigPicture } = useBigPictureContext();
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [showRunAtStartup, setShowRunAtStartup] = useState(false);
  const [defaultDownloadsPath, setDefaultDownloadsPath] = useState("");

  const [form, setForm] = useState({
    seedAfterDownloadComplete: false,
    extractFilesByDefault: true,
    autoDeleteInstallerAfterExtraction: false,
    showDownloadSpeedInMegabytes: false,
    createStartMenuShortcut: true,
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    achievementNotificationsEnabled: true,
    friendRequestNotificationsEnabled: false,
    preferQuitInsteadOfHiding: false,
    hideToTrayOnGameStart: false,
    runAtStartup: false,
    startMinimized: false,
    autoplayGameTrailers: true,
    disableNsfwAlert: false,
  });

  useEffect(() => {
    window.electron.isPortableVersion().then((isPortable) => {
      setShowRunAtStartup(!isPortable);
    });
    window.electron.getDefaultDownloadsPath().then((path) => {
      setDefaultDownloadsPath(path);
    });
  }, []);

  useEffect(() => {
    if (userPreferences) {
      setForm({
        seedAfterDownloadComplete:
          userPreferences.seedAfterDownloadComplete ?? false,
        extractFilesByDefault: userPreferences.extractFilesByDefault ?? true,
        autoDeleteInstallerAfterExtraction:
          userPreferences.autoDeleteInstallerAfterExtraction ?? false,
        showDownloadSpeedInMegabytes:
          userPreferences.showDownloadSpeedInMegabytes ?? false,
        createStartMenuShortcut:
          userPreferences.createStartMenuShortcut ?? true,
        downloadNotificationsEnabled:
          userPreferences.downloadNotificationsEnabled ?? false,
        repackUpdatesNotificationsEnabled:
          userPreferences.repackUpdatesNotificationsEnabled ?? false,
        achievementNotificationsEnabled:
          userPreferences.achievementNotificationsEnabled ?? true,
        friendRequestNotificationsEnabled:
          userPreferences.friendRequestNotificationsEnabled ?? false,
        preferQuitInsteadOfHiding:
          userPreferences.preferQuitInsteadOfHiding ?? false,
        hideToTrayOnGameStart: userPreferences.hideToTrayOnGameStart ?? false,
        runAtStartup: userPreferences.runAtStartup ?? false,
        startMinimized: userPreferences.startMinimized ?? false,
        autoplayGameTrailers: userPreferences.autoplayGameTrailers ?? true,
        disableNsfwAlert: userPreferences.disableNsfwAlert ?? false,
      });
    }
  }, [userPreferences]);

  const languageOptions = useMemo(() => {
    return orderBy(
      Object.entries(languageResources).map(([code, value]) => ({
        code,
        name: value.language_name,
      })),
      ["name"],
      "asc"
    );
  }, []);

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const language = e.target.value;
      i18n.changeLanguage(language);
      window.electron.updateUserPreferences({ language });
    },
    [i18n]
  );

  const handleToggle = useCallback(
    (key: string, value: boolean) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      window.electron.updateUserPreferences({ [key]: value });

      if (key === "runAtStartup") {
        window.electron.autoLaunch({
          enabled: value,
          minimized: form.startMinimized,
        });
      }
      if (key === "startMinimized") {
        window.electron.autoLaunch({
          enabled: form.runAtStartup,
          minimized: value,
        });
      }
    },
    [form.startMinimized, form.runAtStartup]
  );

  const handleChooseDownloadsPath = useCallback(async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: userPreferences?.downloadsPath ?? defaultDownloadsPath,
      properties: ["openDirectory"],
    });

    if (filePaths && filePaths.length > 0) {
      window.electron.updateUserPreferences({ downloadsPath: filePaths[0] });
    }
  }, [userPreferences?.downloadsPath, defaultDownloadsPath]);

  const downloadsPath =
    userPreferences?.downloadsPath || defaultDownloadsPath || "—";

  return (
    <div className="bp-settings">
      {/* ── General ── */}
      <div className="bp-settings__group">
        <div className="bp-settings__group-header">
          <GlobeIcon size={22} />
          <h2>{t("settings_general")}</h2>
        </div>

        <div className="bp-settings__card">
          <div className="bp-settings__row">
            <div className="bp-settings__row-text">
              <span className="bp-settings__row-label">{t("language")}</span>
            </div>
            <select
              className="bp-settings__select"
              value={i18n.language}
              onChange={handleLanguageChange}
              data-bp-focusable
            >
              {languageOptions.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>

          <div className="bp-settings__row">
            <div className="bp-settings__row-text">
              <span className="bp-settings__row-label">
                {t("downloads_path")}
              </span>
              <span className="bp-settings__row-description bp-settings__row-description--path">
                {downloadsPath}
              </span>
            </div>
            <button
              type="button"
              className="bp-settings__action-btn"
              data-bp-focusable
              onClick={handleChooseDownloadsPath}
            >
              <FileDirectoryIcon size={16} />
              {t("settings_change")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Downloads ── */}
      <div className="bp-settings__group">
        <div className="bp-settings__group-header">
          <DownloadIcon size={22} />
          <h2>{t("settings_downloads")}</h2>
        </div>

        <div className="bp-settings__card">
          <SettingToggle
            label={t("seed_after_download")}
            description={t("settings_seed_description")}
            checked={form.seedAfterDownloadComplete}
            onChange={() =>
              handleToggle(
                "seedAfterDownloadComplete",
                !form.seedAfterDownloadComplete
              )
            }
          />
          <SettingToggle
            label={t("auto_extract")}
            description={t("settings_auto_extract_description")}
            checked={form.extractFilesByDefault}
            onChange={() =>
              handleToggle("extractFilesByDefault", !form.extractFilesByDefault)
            }
          />
          <SettingToggle
            label={t("settings_auto_delete_installer")}
            description={t("settings_auto_delete_installer_description")}
            checked={form.autoDeleteInstallerAfterExtraction}
            onChange={() =>
              handleToggle(
                "autoDeleteInstallerAfterExtraction",
                !form.autoDeleteInstallerAfterExtraction
              )
            }
          />
          <SettingToggle
            label={t("settings_speed_in_mb")}
            description={t("settings_speed_in_mb_description")}
            checked={form.showDownloadSpeedInMegabytes}
            onChange={() =>
              handleToggle(
                "showDownloadSpeedInMegabytes",
                !form.showDownloadSpeedInMegabytes
              )
            }
          />
          {window.electron.platform === "win32" && (
            <SettingToggle
              label={t("settings_start_menu_shortcut")}
              description={t("settings_start_menu_shortcut_description")}
              checked={form.createStartMenuShortcut}
              onChange={() =>
                handleToggle(
                  "createStartMenuShortcut",
                  !form.createStartMenuShortcut
                )
              }
            />
          )}
        </div>
      </div>

      {/* ── Notifications ── */}
      <div className="bp-settings__group">
        <div className="bp-settings__group-header">
          <BellIcon size={22} />
          <h2>{t("settings_notifications")}</h2>
        </div>

        <div className="bp-settings__card">
          <SettingToggle
            label={t("settings_download_notifications")}
            description={t("settings_download_notifications_description")}
            checked={form.downloadNotificationsEnabled}
            onChange={() =>
              handleToggle(
                "downloadNotificationsEnabled",
                !form.downloadNotificationsEnabled
              )
            }
          />
          <SettingToggle
            label={t("settings_repack_notifications")}
            description={t("settings_repack_notifications_description")}
            checked={form.repackUpdatesNotificationsEnabled}
            onChange={() =>
              handleToggle(
                "repackUpdatesNotificationsEnabled",
                !form.repackUpdatesNotificationsEnabled
              )
            }
          />
          <SettingToggle
            label={t("settings_achievement_notifications")}
            description={t("settings_achievement_notifications_description")}
            checked={form.achievementNotificationsEnabled}
            onChange={() =>
              handleToggle(
                "achievementNotificationsEnabled",
                !form.achievementNotificationsEnabled
              )
            }
          />
          <SettingToggle
            label={t("settings_friend_notifications")}
            description={t("settings_friend_notifications_description")}
            checked={form.friendRequestNotificationsEnabled}
            onChange={() =>
              handleToggle(
                "friendRequestNotificationsEnabled",
                !form.friendRequestNotificationsEnabled
              )
            }
          />
        </div>
      </div>

      {/* ── Application ── */}
      <div className="bp-settings__group">
        <div className="bp-settings__group-header">
          <GearIcon size={22} />
          <h2>{t("settings_application")}</h2>
        </div>

        <div className="bp-settings__card">
          {showRunAtStartup && (
            <SettingToggle
              label={t("settings_launch_startup")}
              description={t("settings_launch_startup_description")}
              checked={form.runAtStartup}
              onChange={() => handleToggle("runAtStartup", !form.runAtStartup)}
            />
          )}
          {showRunAtStartup && (
            <SettingToggle
              label={t("settings_start_minimized")}
              description={t("settings_start_minimized_description")}
              checked={form.startMinimized}
              disabled={!form.runAtStartup}
              onChange={() =>
                handleToggle("startMinimized", !form.startMinimized)
              }
            />
          )}
          <SettingToggle
            label={t("settings_quit_instead_hide")}
            description={t("settings_quit_instead_hide_description")}
            checked={form.preferQuitInsteadOfHiding}
            onChange={() =>
              handleToggle(
                "preferQuitInsteadOfHiding",
                !form.preferQuitInsteadOfHiding
              )
            }
          />
          <SettingToggle
            label={t("settings_hide_tray_game")}
            description={t("settings_hide_tray_game_description")}
            checked={form.hideToTrayOnGameStart}
            onChange={() =>
              handleToggle("hideToTrayOnGameStart", !form.hideToTrayOnGameStart)
            }
          />
          <SettingToggle
            label={t("settings_autoplay_trailers")}
            description={t("settings_autoplay_trailers_description")}
            checked={form.autoplayGameTrailers}
            onChange={() =>
              handleToggle("autoplayGameTrailers", !form.autoplayGameTrailers)
            }
          />
          <SettingToggle
            label={t("settings_disable_nsfw")}
            description={t("settings_disable_nsfw_description")}
            checked={form.disableNsfwAlert}
            onChange={() =>
              handleToggle("disableNsfwAlert", !form.disableNsfwAlert)
            }
          />
        </div>
      </div>

      {/* ── Exit ── */}
      <div className="bp-settings__group bp-settings__group--exit">
        <button
          type="button"
          className="bp-settings__exit-btn"
          data-bp-focusable
          onClick={exitBigPicture}
        >
          <SignOutIcon size={20} />
          {t("exit_big_picture")}
        </button>
      </div>
    </div>
  );
}
