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
  CheckboxField,
  SelectField,
} from "@renderer/components";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "@renderer/hooks";
import { changeLanguage } from "i18next";
import languageResources from "@locales";
import { orderBy } from "lodash-es";
import { settingsContext } from "@renderer/context";
import "./settings-general.scss";
import { DesktopDownloadIcon, UnmuteIcon } from "@primer/octicons-react";
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

  const [canInstallCommonRedist, setCanInstallCommonRedist] = useState(false);
  const [installingCommonRedist, setInstallingCommonRedist] = useState(false);

  const [form, setForm] = useState({
    downloadsPath: "",
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    friendRequestNotificationsEnabled: false,
    friendStartGameNotificationsEnabled: true,
    achievementNotificationsEnabled: true,
    achievementCustomNotificationsEnabled: true,
    achievementCustomNotificationPosition:
      "top-left" as AchievementCustomNotificationPosition,
    achievementSoundVolume: 15,
    language: "",
    customStyles: window.localStorage.getItem("customStyles") || "",
    useNativeHttpDownloader: false,
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
        language: language ?? "en",
        useNativeHttpDownloader:
          userPreferences.useNativeHttpDownloader ?? false,
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

  const handleChangeAchievementCustomNotificationPosition = async (
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

  return (
    <div className="settings-general">
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

      <h2 className="settings-general__section-title">{t("downloads")}</h2>

      <CheckboxField
        label={t("use_native_http_downloader")}
        checked={form.useNativeHttpDownloader}
        onChange={() =>
          handleChange({
            useNativeHttpDownloader: !form.useNativeHttpDownloader,
          })
        }
      />

      <h2 className="settings-general__section-title">{t("notifications")}</h2>

      <CheckboxField
        label={t("enable_download_notifications")}
        checked={form.downloadNotificationsEnabled}
        onChange={() =>
          handleChange({
            downloadNotificationsEnabled: !form.downloadNotificationsEnabled,
          })
        }
      />

      <CheckboxField
        label={t("enable_repack_list_notifications")}
        checked={form.repackUpdatesNotificationsEnabled}
        onChange={() =>
          handleChange({
            repackUpdatesNotificationsEnabled:
              !form.repackUpdatesNotificationsEnabled,
          })
        }
      />

      <CheckboxField
        label={t("enable_friend_request_notifications")}
        checked={form.friendRequestNotificationsEnabled}
        onChange={() =>
          handleChange({
            friendRequestNotificationsEnabled:
              !form.friendRequestNotificationsEnabled,
          })
        }
      />

      <CheckboxField
        label={t("enable_friend_start_game_notifications")}
        checked={form.friendStartGameNotificationsEnabled}
        onChange={() =>
          handleChange({
            friendStartGameNotificationsEnabled:
              !form.friendStartGameNotificationsEnabled,
          })
        }
      />

      <CheckboxField
        label={t("enable_achievement_notifications")}
        checked={form.achievementNotificationsEnabled}
        onChange={async () => {
          await handleChange({
            achievementNotificationsEnabled:
              !form.achievementNotificationsEnabled,
          });

          window.electron.updateAchievementCustomNotificationWindow();
        }}
      />

      <CheckboxField
        label={t("enable_achievement_custom_notifications")}
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

      {form.achievementNotificationsEnabled &&
        form.achievementCustomNotificationsEnabled && (
          <>
            <SelectField
              className="settings-general__achievement-custom-notification-position__select-variation"
              label={t("achievement_custom_notification_position")}
              value={form.achievementCustomNotificationPosition}
              onChange={handleChangeAchievementCustomNotificationPosition}
              options={achievementCustomNotificationPositionOptions}
            />

            <Button
              className="settings-general__test-achievement-notification-button"
              onClick={() => window.electron.showAchievementTestNotification()}
            >
              {t("test_notification")}
            </Button>
          </>
        )}

      {form.achievementNotificationsEnabled && (
        <div className="settings-general__volume-control">
          <label htmlFor="achievement-volume">
            {t("achievement_sound_volume")}
          </label>
          <div className="settings-general__volume-slider-wrapper">
            <UnmuteIcon size={16} className="settings-general__volume-icon" />
            <input
              id="achievement-volume"
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

      <h2 className="settings-general__section-title">{t("common_redist")}</h2>

      <p className="settings-general__common-redist-description">
        {t("common_redist_description")}
      </p>

      <Button
        onClick={handleInstallCommonRedist}
        className="settings-general__common-redist-button"
        disabled={!canInstallCommonRedist || installingCommonRedist}
      >
        <DesktopDownloadIcon />
        {installingCommonRedist
          ? t("installing_common_redist")
          : t("install_common_redist")}
      </Button>
    </div>
  );
}
