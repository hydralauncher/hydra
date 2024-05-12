import { useEffect, useState } from "react";

import { TextField, Button, CheckboxField } from "@renderer/components";
import { useTranslation } from "react-i18next";

import * as styles from "./settings-general.css";
import type { UserPreferences } from "@types";

export interface SettingsGeneralProps {
  userPreferences: UserPreferences | null;
  updateUserPreferences: (values: Partial<UserPreferences>) => void;
}

export function SettingsGeneral({
  userPreferences,
  updateUserPreferences,
}: SettingsGeneralProps) {
  const [form, setForm] = useState({
    downloadsPath: "",
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    telemetryEnabled: false,
  });

  useEffect(() => {
    if (userPreferences) {
      const {
        downloadsPath,
        downloadNotificationsEnabled,
        repackUpdatesNotificationsEnabled,
        telemetryEnabled,
      } = userPreferences;

      window.electron.getDefaultDownloadsPath().then((defaultDownloadsPath) => {
        setForm((prev) => ({
          ...prev,
          downloadsPath: downloadsPath ?? defaultDownloadsPath,
          downloadNotificationsEnabled,
          repackUpdatesNotificationsEnabled,
          telemetryEnabled,
        }));
      });
    }
  }, [userPreferences]);

  const { t } = useTranslation("settings");

  const handleChooseDownloadsPath = async () => {
    const { canceled, filePaths } = await window.electron.showOpenDialog({
      title: t("download_path_selection.title"),
      defaultPath: form.downloadsPath,
      properties: ["openDirectory"],
    });

    if (!canceled) {
      const path = filePaths[0];
      updateUserPreferences({ downloadsPath: path });
    }
  };

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

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

      <h3>{t("notifications")}</h3>

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

      <h3>{t("telemetry")}</h3>

      <CheckboxField
        label={t("telemetry_description")}
        checked={form.telemetryEnabled}
        onChange={() =>
          handleChange({
            telemetryEnabled: !form.telemetryEnabled,
          })
        }
      />
    </>
  );
}
