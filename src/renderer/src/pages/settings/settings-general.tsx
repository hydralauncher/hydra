import { useContext, useEffect, useMemo, useState } from "react";
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
import { DesktopDownloadIcon } from "@primer/octicons-react";
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
    achievementNotificationsEnabled: true,
    achievementCustomNotificationsEnabled: true,
    achievementCustomNotificationPosition:
      "top-left" as AchievementCustomNotificationPosition,
    language: "",
    customStyles: window.localStorage.getItem("customStyles") || "",
  });

  const [languageOptions, setLanguageOptions] = useState<LanguageOption[]>([]);

  const [defaultDownloadsPath, setDefaultDownloadsPath] = useState("");

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
        friendRequestNotificationsEnabled:
          userPreferences.friendRequestNotificationsEnabled ?? false,
        language: language ?? "en",
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
