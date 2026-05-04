import {
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
} from "react";
import {
  TextField,
  Button,
  SelectField,
  ToggleSwitch,
} from "@renderer/components";
import { useTranslation } from "react-i18next";
import { useAppSelector, useLibrary } from "@renderer/hooks";
import { changeLanguage } from "i18next";
import languageResources from "@locales";
import { orderBy } from "lodash-es";
import { settingsContext } from "@renderer/context";
import "./settings-general.scss";
import {
  DesktopDownloadIcon,
  SyncIcon,
  ToolsIcon,
  UnmuteIcon,
} from "@primer/octicons-react";
import { logger } from "@renderer/logger";
import { AchievementCustomNotificationPosition } from "@types";

interface LanguageOption {
  option: string;
  nativeName: string;
}

export function SettingsGeneral() {
  const { t } = useTranslation("settings");

  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const lastPacket = useAppSelector((state) => state.download.lastPacket);
  const hasActiveDownload =
    lastPacket !== null &&
    lastPacket.progress < 1 &&
    !lastPacket.isDownloadingMetadata;

  const [canInstallCommonRedist, setCanInstallCommonRedist] = useState(false);
  const [installingCommonRedist, setInstallingCommonRedist] = useState(false);
  const [isSteamImporting, setIsSteamImporting] = useState(false);
  const [steamImportResult, setSteamImportResult] = useState<{
    importedCount: number;
    totalFound: number;
    alreadyInLibrary: number;
  } | null>(null);

  const { updateLibrary } = useLibrary();

  const [form, setForm] = useState({
    downloadsPath: "",
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    friendRequestNotificationsEnabled: false,
    friendStartGameNotificationsEnabled: true,
    friendStartGameCustomNotificationsEnabled: true,
    achievementNotificationsEnabled: true,
    achievementCustomNotificationsEnabled: true,
    achievementCustomNotificationPosition:
      "top-left" as AchievementCustomNotificationPosition,
    achievementSoundVolume: 15,
    language: "",
    customStyles: window.localStorage.getItem("customStyles") || "",
    useNativeHttpDownloader: true,
  });

  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);

  const [defaultDownloadsPath, setDefaultDownloadsPath] = useState("");

  const volumeUpdateTimeoutRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    window.electron.getDefaultDownloadsPath().then((path) => {
      setDefaultDownloadsPath(path);
    });

    window.electron.canInstallCommonRedist().then((canInstall) => {
      setCanInstallCommonRedist(canInstall);
    });

    const interval = setInterval(() => {
      window.electron.canInstallCommonRedist().then((canInstall) => {
        setCanInstallCommonRedist(canInstall);
      });
    }, 1000 * 5);

    setLanguageOptions(
      orderBy(
        Object.entries(languageResources).map(([language, value]) => {
          return {
            nativeName: value.language_name,
            option: language,
          };
        }),
        ["nativeName"],
        "asc"
      )
    );

    return () => {
      clearInterval(interval);
      if (volumeUpdateTimeoutRef.current) {
        clearTimeout(volumeUpdateTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (userPreferences) {
      const languageKeys = Object.keys(languageResources);
      const language =
        languageKeys.find(
          (language) => language === userPreferences.language
        ) ??
        languageKeys.find((language) => {
          return language.startsWith(
            userPreferences.language?.split("-")[0] ?? "en"
          );
        });

      setForm((prev) => ({
        ...prev,
        downloadsPath: userPreferences.downloadsPath ?? defaultDownloadsPath,
        downloadNotificationsEnabled:
          userPreferences.downloadNotificationsEnabled ?? false,
        repackUpdatesNotificationsEnabled:
          userPreferences.repackUpdatesNotificationsEnabled ?? false,
        achievementNotificationsEnabled:
          userPreferences.achievementNotificationsEnabled ?? true,
        achievementCustomNotificationsEnabled:
          userPreferences.achievementCustomNotificationsEnabled ?? true,
        achievementCustomNotificationPosition:
          userPreferences.achievementCustomNotificationPosition ?? "top-left",
        achievementSoundVolume: Math.round(
          (userPreferences.achievementSoundVolume ?? 0.15) * 100
        ),
        friendRequestNotificationsEnabled:
          userPreferences.friendRequestNotificationsEnabled ?? false,
        friendStartGameNotificationsEnabled:
          userPreferences.friendStartGameNotificationsEnabled ?? true,
        friendStartGameCustomNotificationsEnabled:
          userPreferences.friendStartGameCustomNotificationsEnabled ?? true,
        language: language ?? "en",
        useNativeHttpDownloader:
          userPreferences.useNativeHttpDownloader ?? true,
      }));
    }
  }, [userPreferences, defaultDownloadsPath]);

  const achievementCustomNotificationPositionOptions = useMemo(() => {
    return [
      "top-left",
      "top-center",
      "top-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ].map((position) => ({
      key: position,
      value: position,
      label: t(position),
    }));
  }, [t]);

  const handleLanguageChange = (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value;

    handleChange({ language: value });
    changeLanguage(value);
  };

  const handleChange = async (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    await updateUserPreferences(values);
  };

  const handleVolumeChange = useCallback(
    (newVolume: number) => {
      setForm((prev) => ({ ...prev, achievementSoundVolume: newVolume }));

      if (volumeUpdateTimeoutRef.current) {
        clearTimeout(volumeUpdateTimeoutRef.current);
      }

      volumeUpdateTimeoutRef.current = setTimeout(() => {
        updateUserPreferences({ achievementSoundVolume: newVolume / 100 });
      }, 300);
    },
    [updateUserPreferences]
  );

  const handleChangeCustomNotificationPosition = async (
    event: React.ChangeEvent<HTMLSelectElement>
  ) => {
    const value = event.target.value as AchievementCustomNotificationPosition;

    await handleChange({ achievementCustomNotificationPosition: value });

    window.electron.updateAchievementCustomNotificationWindow();
  };

  const handleChooseDownloadsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: form.downloadsPath,
      properties: ["openDirectory"],
    });

    if (filePaths && filePaths.length > 0) {
      const path = filePaths[0];
      handleChange({ downloadsPath: path });
    }
  };

  useEffect(() => {
    const unlisten = window.electron.onCommonRedistProgress(
      ({ log, complete }) => {
        if (log === "Installation timed out" || complete) {
          setInstallingCommonRedist(false);
        }
      }
    );

    return () => unlisten();
  }, []);

  const handleInstallCommonRedist = async () => {
    setInstallingCommonRedist(true);
    try {
      await window.electron.installCommonRedist();
    } catch (err) {
      logger.error(err);
      setInstallingCommonRedist(false);
    }
  };

  const hasAnyCustomNotificationEnabled =
    (form.achievementNotificationsEnabled &&
      form.achievementCustomNotificationsEnabled) ||
    (form.friendStartGameNotificationsEnabled &&
      form.friendStartGameCustomNotificationsEnabled);

  return (
    <div className="settings-general">
      {/* General */}
      <div className="settings-general__section">
        <TextField
          label={t("downloads_path")}
          value={form.downloadsPath}
          readOnly
          disabled
          rightContent={
            <Button theme="outline" onClick={handleChooseDownloadsPath}>
              {t("change")}
            </Button>
          }
        />

        <SelectField
          label={t("language")}
          value={form.language}
          onChange={handleLanguageChange}
          options={languageOptions.map((language) => ({
            key: language.option,
            value: language.option,
            label: language.nativeName,
          }))}
        />
      </div>

      {/* Downloads */}
      <div className="settings-general__section">
        <div className="settings-general__section-header">
          <h3 className="settings-general__section-title">{t("downloads")}</h3>
          <p className="settings-general__section-description">
            {t("downloads_section_description")}
          </p>
        </div>

        <div className="settings-general__toggles">
          <ToggleSwitch
            label={t("use_native_http_downloader")}
            description={t("use_native_http_downloader_desc")}
            checked={form.useNativeHttpDownloader}
            disabled={hasActiveDownload}
            onChange={() =>
              handleChange({
                useNativeHttpDownloader: !form.useNativeHttpDownloader,
              })
            }
          />

          {hasActiveDownload && (
            <p className="settings-general__hint">
              {t("cannot_change_downloader_while_downloading")}
            </p>
          )}
        </div>
      </div>

      {/* System Notifications */}
      <div className="settings-general__section">
        <div className="settings-general__section-header">
          <h3 className="settings-general__section-title">
            {t("notifications")}
          </h3>
          <p className="settings-general__section-description">
            {t("notifications_description")}
          </p>
        </div>

        <div className="settings-general__toggles">
          <ToggleSwitch
            label={t("enable_download_notifications")}
            description={t("enable_download_notifications_desc")}
            checked={form.downloadNotificationsEnabled}
            onChange={() =>
              handleChange({
                downloadNotificationsEnabled:
                  !form.downloadNotificationsEnabled,
              })
            }
          />

          <ToggleSwitch
            label={t("enable_repack_list_notifications")}
            description={t("enable_repack_list_notifications_desc")}
            checked={form.repackUpdatesNotificationsEnabled}
            onChange={() =>
              handleChange({
                repackUpdatesNotificationsEnabled:
                  !form.repackUpdatesNotificationsEnabled,
              })
            }
          />

          <ToggleSwitch
            label={t("enable_friend_request_notifications")}
            description={t("enable_friend_request_notifications_desc")}
            checked={form.friendRequestNotificationsEnabled}
            onChange={() =>
              handleChange({
                friendRequestNotificationsEnabled:
                  !form.friendRequestNotificationsEnabled,
              })
            }
          />

          <ToggleSwitch
            label={t("enable_friend_start_game_notifications")}
            description={t("enable_friend_start_game_notifications_desc")}
            checked={form.friendStartGameNotificationsEnabled}
            onChange={async () => {
              await handleChange({
                friendStartGameNotificationsEnabled:
                  !form.friendStartGameNotificationsEnabled,
              });
              window.electron.updateAchievementCustomNotificationWindow();
            }}
          />

          <ToggleSwitch
            label={t("enable_achievement_notifications")}
            description={t("enable_achievement_notifications_desc")}
            checked={form.achievementNotificationsEnabled}
            onChange={async () => {
              await handleChange({
                achievementNotificationsEnabled:
                  !form.achievementNotificationsEnabled,
              });
              window.electron.updateAchievementCustomNotificationWindow();
            }}
          />
        </div>
      </div>

      {/* Custom In-App Notifications */}
      <div className="settings-general__section">
        <div className="settings-general__section-header">
          <h3 className="settings-general__section-title">
            {t("custom_notifications")}
          </h3>
          <p className="settings-general__section-description">
            {t("custom_notifications_description")}
          </p>
        </div>

        <div className="settings-general__toggles">
          <ToggleSwitch
            label={t("enable_achievement_custom_notifications")}
            description={t("enable_achievement_custom_notifications_desc")}
            checked={form.achievementCustomNotificationsEnabled}
            disabled={!form.achievementNotificationsEnabled}
            onChange={async () => {
              await handleChange({
                achievementCustomNotificationsEnabled:
                  !form.achievementCustomNotificationsEnabled,
              });
              window.electron.updateAchievementCustomNotificationWindow();
            }}
          />

          <ToggleSwitch
            label={t("enable_friend_start_game_custom_notifications")}
            description={t(
              "enable_friend_start_game_custom_notifications_desc"
            )}
            checked={form.friendStartGameCustomNotificationsEnabled}
            disabled={!form.friendStartGameNotificationsEnabled}
            onChange={async () => {
              await handleChange({
                friendStartGameCustomNotificationsEnabled:
                  !form.friendStartGameCustomNotificationsEnabled,
              });
              window.electron.updateAchievementCustomNotificationWindow();
            }}
          />
        </div>

        {hasAnyCustomNotificationEnabled && (
          <div className="settings-general__notification-options">
            <SelectField
              className="settings-general__position-select"
              label={t("custom_notification_position")}
              value={form.achievementCustomNotificationPosition}
              onChange={handleChangeCustomNotificationPosition}
              options={achievementCustomNotificationPositionOptions}
            />

            <div className="settings-general__test-buttons">
              <span className="settings-general__test-label">
                {t("test_notifications")}
              </span>
              <div className="settings-general__test-row">
                <Button
                  theme="outline"
                  disabled={
                    !form.achievementNotificationsEnabled ||
                    !form.achievementCustomNotificationsEnabled
                  }
                  onClick={() =>
                    window.electron.showAchievementTestNotification()
                  }
                >
                  {t("test_achievement")}
                </Button>
                <Button
                  theme="outline"
                  disabled={
                    !form.friendStartGameNotificationsEnabled ||
                    !form.friendStartGameCustomNotificationsEnabled
                  }
                  onClick={() => window.electron.showFriendTestNotification()}
                >
                  {t("test_friend_activity")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sound */}
      {form.achievementNotificationsEnabled && (
        <div className="settings-general__section">
          <div className="settings-general__section-header">
            <h3 className="settings-general__section-title">
              {t("achievement_sound_volume")}
            </h3>
          </div>

          <div className="settings-general__volume-slider-wrapper">
            <UnmuteIcon size={16} className="settings-general__volume-icon" />
            <input
              type="range"
              min="0"
              max="100"
              value={form.achievementSoundVolume}
              onChange={(e) => {
                const volumePercent = parseInt(e.target.value, 10);
                if (!isNaN(volumePercent)) {
                  handleVolumeChange(volumePercent);
                }
              }}
              className="settings-general__volume-slider"
              style={
                {
                  "--volume-percent": `${form.achievementSoundVolume}%`,
                } as React.CSSProperties
              }
            />
            <span className="settings-general__volume-value">
              {form.achievementSoundVolume}%
            </span>
          </div>
        </div>
      )}

      {/* Tools */}
      <div className="settings-general__section">
        <div className="settings-general__section-header">
          <h3 className="settings-general__section-title">
            {t("common_redist")}
          </h3>
          <p className="settings-general__section-description">
            {t("common_redist_description")}
          </p>
        </div>

        <Button
          onClick={handleInstallCommonRedist}
          className="settings-general__action-button"
          disabled={!canInstallCommonRedist || installingCommonRedist}
        >
          <DesktopDownloadIcon />
          {installingCommonRedist
            ? t("installing_common_redist")
            : t("install_common_redist")}
        </Button>
      </div>

      {/* Steam Import */}
      <div className="settings-general__section">
        <div className="settings-general__section-header">
          <h3 className="settings-general__section-title">
            {t("steam_import")}
          </h3>
          <p className="settings-general__section-description">
            {t("steam_import_description")}
          </p>
        </div>

        <Button
          onClick={async () => {
            setIsSteamImporting(true);
            setSteamImportResult(null);
            try {
              const result = await window.electron.importSteamGames();
              setSteamImportResult(result);
              updateLibrary();
            } catch (err) {
              logger.error(err);
            } finally {
              setIsSteamImporting(false);
            }
          }}
          className="settings-general__action-button"
          disabled={isSteamImporting}
        >
          <SyncIcon />
          {isSteamImporting ? t("steam_importing") : t("steam_import_button")}
        </Button>

        {steamImportResult && (
          <p className="settings-general__result-text">
            {t("steam_import_result", {
              imported: steamImportResult.importedCount,
              total: steamImportResult.totalFound,
              existing: steamImportResult.alreadyInLibrary,
            })}
          </p>
        )}
      </div>

      {/* Developer */}
      <div className="settings-general__section">
        <div className="settings-general__section-header">
          <h3 className="settings-general__section-title">{t("developer")}</h3>
          <p className="settings-general__section-description">
            {t("developer_description")}
          </p>
        </div>

        <Button
          onClick={() => window.electron.openDevTools()}
          className="settings-general__action-button"
        >
          <ToolsIcon />
          {t("open_dev_tools")}
        </Button>
      </div>
    </div>
  );
}
