import { useEffect, useState } from "react";
import { Button, CheckboxField, TextField } from "@renderer/components";

import * as styles from "./settings.css";
import { useTranslation } from "react-i18next";
import { UserPreferences } from "@types";
import { changeLanguage } from "i18next";

export function Settings() {
  const [form, setForm] = useState({
    downloadsPath: "",
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    telemetryEnabled: false,
    fullscreenEnabled: false,
    width: 0,
    height: 0
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
        fullscreenEnabled: userPreferences?.fullscreenEnabled ?? false,
        width: userPreferences?.width ?? 1200,
        height: userPreferences?.height ?? 800
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

  const handleWidthChange = (e) => {
    const value = e.target.value;
    // Validar se o valor inserido contém apenas números
    if (/^\d*$/.test(value)) {
      setForm(prevState => ({
        ...prevState,
        width: value
      }));
    }
  };

  const handleHeightChange = (e) => {
    const value = e.target.value;
    // Validar se o valor inserido contém apenas números
    if (/^\d*$/.test(value)) {
      setForm(prevState => ({
        ...prevState,
        height: value
      }));
    }
  };

  const { i18n } = useTranslation();

  const [selectedOption, setSelectedOption] = useState(i18n.language);

  const handleLanguageChange = (e) => {
    const value = e.target.value;
    setSelectedOption(value);
    changeLanguage(value);
  };

  const getLanguage = () => {
    if (i18n.language.startsWith("pt")) return "Idioma do sistema";
    if (i18n.language.startsWith("es")) return "Lenguaje del sistema";
    if (i18n.language.startsWith("fr")) return "Langue du système";

    return "System Language";
  };

  const getLanguageName = () => {
    if (i18n.language.startsWith("pt")) return "Português";
    if (i18n.language.startsWith("es")) return "Español";
    if (i18n.language.startsWith("fr")) return "Français";

    return "English";
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

        {form.fullscreenEnabled === false && (
          <div className={styles.resolutionContent}>
          <div className={styles.resolutionField}>
          <>
            <input
              type="text"
              value={form.width}
              onChange={handleWidthChange}
              placeholder="Resolução X"
            />
            <input
              type="text"
              value={form.height}
              onChange={handleHeightChange}
              placeholder="Resolução Y"
            />
          </>
          </div>
          </div>
        )}


        <h3>{t("title_language")}</h3>

          <select value={selectedOption} onChange={handleLanguageChange}>
            <option value="">Selecione...</option>
            <option value="en">English</option>
            <option value="pt">Português Brasil</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
          </select>

          {selectedOption && (
            <p>{t("system_language")}: {t("language_name")}</p>
          )}
      </div>
    </section>
  );
}

