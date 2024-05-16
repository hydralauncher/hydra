import { useEffect, useState } from "react";
import ISO6391 from "iso-639-1";

import { TextField, Button, CheckboxField, Select } from "@renderer/components";
import { useTranslation } from "react-i18next";
import * as styles from "./settings-general.css";
import type { UserPreferences } from "@types";

import { changeLanguage } from "i18next";
import * as languageResources from "@locales";

export interface SettingsGeneralProps {
  userPreferences: UserPreferences | null;
  updateUserPreferences: (values: Partial<UserPreferences>) => void;
}

export function SettingsGeneral({
  userPreferences,
  updateUserPreferences,
}: SettingsGeneralProps) {
  const { t } = useTranslation("settings");

  const [form, setForm] = useState({
    downloadsPath: "",
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    language: "",
  });

  const [defaultDownloadsPath, setdefaultDownloadsPath] = useState("");

  useEffect(() => {
    async function fetchdefaultDownloadsPath() {
      setdefaultDownloadsPath(await window.electron.getDefaultDownloadsPath());
    }

    fetchdefaultDownloadsPath();
  }, []);

  useEffect(updateFormWithUserPreferences, [
    userPreferences,
    defaultDownloadsPath,
  ]);

  const handleLanguageChange = (event) => {
    const value = event.target.value;

    handleChange({ language: value });
    changeLanguage(value);
  };

  const handleChange = (values: Partial<typeof form>) => {
    // TODO: why is the setForm needed if updateUserPreferences already changes the
    // UserPreferences and useEffect(updateFormWithUserPreferences)
    // does the setForm((prev) in the callback function?
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
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

  function updateFormWithUserPreferences() {
    if (userPreferences) {
      setForm((prev) => ({
        ...prev,
        downloadsPath: userPreferences.downloadsPath ?? defaultDownloadsPath,
        downloadNotificationsEnabled:
          userPreferences.downloadNotificationsEnabled,
        repackUpdatesNotificationsEnabled:
          userPreferences.repackUpdatesNotificationsEnabled,
        language: userPreferences.language,
      }));
    }
  }

  return (
    <>
      <div className={styles.downloadsPathField}>
        <TextField
          label={t("downloads_path")}
          value={form.downloadsPath}
          readOnly
          disabled
        />

        <Button
          style={{ alignSelf: "flex-end" }}
          theme="outline"
          onClick={handleChooseDownloadsPath}
        >
          {t("change")}
        </Button>
      </div>

      <h3>{t("language")}</h3>
      <>
        <Select value={form.language} onChange={handleLanguageChange}>
          {Object.keys(languageResources).map((language) => (
            <option key={language} value={language}>
              {ISO6391.getName(language)}
            </option>
          ))}
        </Select>
      </>

      <h3>{t("notifications")}</h3>
      <>
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
      </>
    </>
  );
}
