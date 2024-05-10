import { useEffect, useState } from "react";
import { Button, CheckboxField, TextField, Select} from "@renderer/components";

import * as styles from "./settings.css";
import { useTranslation } from "react-i18next";
import { UserPreferences } from "@types";
import { changeLanguage } from "i18next";
import { useDate } from "@renderer/hooks/use-date";

export function Settings() {
  const [form, setForm] = useState({
    downloadsPath: "",
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    telemetryEnabled: false,
    fullscreenEnabled: false
  });

  const { t } = useTranslation("settings");

  useEffect(() => {
    Promise.all([
      window.electron.getDefaultDownloadsPath(),
      window.electron.getUserPreferences(),
    ]).then(([path, userPreferences]) => {
      setForm({
        downloadsPath: userPreferences?.downloadsPath || path,
        downloadNotificationsEnabled:
          userPreferences?.downloadNotificationsEnabled ?? false,
        repackUpdatesNotificationsEnabled:
          userPreferences?.repackUpdatesNotificationsEnabled ?? false,
        telemetryEnabled: userPreferences?.telemetryEnabled ?? false,
        fullscreenEnabled: userPreferences?.fullscreenEnabled ?? false
      });
    });
  }, []);

  const updateUserPreferences = <T extends keyof UserPreferences>(
    field: T,
    value: UserPreferences[T]
  ) => {
    setForm((prev) => ({ ...prev, [field]: value }));

    window.electron.updateUserPreferences({
      [field]: value,
    });
  };

  const handleChooseDownloadsPath = async () => {
    const { filePaths } = await window.electron.showOpenDialog({
      defaultPath: form.downloadsPath,
      properties: ["openDirectory"],
    });

    if (filePaths && filePaths.length > 0) {
      const path = filePaths[0];
      updateUserPreferences("downloadsPath", path);
    }
  };

  const { i18n } = useTranslation();

  const [selectedOption, setSelectedOption] = useState(i18n.language);

  const handleLanguageChange = (e) => {
    const value = e.target.value;
    setSelectedOption(value);
    changeLanguage(value);
  };

  return (
    <section className={styles.container}>
      <div className={styles.content}>
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

        <h3>{t("notifications")}</h3>

        <CheckboxField
          label={t("enable_download_notifications")}
          checked={form.downloadNotificationsEnabled}
          onChange={() =>
            updateUserPreferences(
              "downloadNotificationsEnabled",
              !form.downloadNotificationsEnabled
            )
          }
        />

        <CheckboxField
          label={t("enable_repack_list_notifications")}
          checked={form.repackUpdatesNotificationsEnabled}
          onChange={() =>
            updateUserPreferences(
              "repackUpdatesNotificationsEnabled",
              !form.repackUpdatesNotificationsEnabled
            )
          }
        />

        <h3>{t("telemetry")}</h3>

        <CheckboxField
          label={t("telemetry_description")}
          checked={form.telemetryEnabled}
          onChange={() =>
            updateUserPreferences("telemetryEnabled", !form.telemetryEnabled)
          }
        />

        <h3>{t("fullscreen")}</h3>

        <CheckboxField
          label={t("fullscreen_description")}
          checked={form.fullscreenEnabled}
          onChange={() =>
            updateUserPreferences("fullscreenEnabled", !form.fullscreenEnabled)
          }
        />

        <h3>{t("title_language")}</h3>

            {/* <select value={selectedOption} onChange={handleLanguageChange}>
              <option value="">{}</option>
              <option value="en">English</option>
              <option value="pt">Português Brasil</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
            </select> */}

            <Select value={selectedOption} onChange={handleLanguageChange}>
              <option value="">{}</option>
              <option value="en">English</option>
              <option value="pt">Português Brasil</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
            </Select>

            {selectedOption && (
              <p>{t("system_language")}: {t("language_name")}</p>
            )}

      </div>
    </section>
  );
}

