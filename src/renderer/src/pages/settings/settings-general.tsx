import { useEffect, useState } from "react";

import { TextField, Button, CheckboxField } from "@renderer/components";
import { useTranslation } from "react-i18next";

import * as styles from "./settings-general.css";
import type { UserPreferences } from "@types";
import { useAppSelector } from "@renderer/hooks";

export interface SettingsGeneralProps {
  updateUserPreferences: (values: Partial<UserPreferences>) => void;
}

export function SettingsGeneral({
  updateUserPreferences,
}: SettingsGeneralProps) {
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState({
    downloadsPath: "",
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
  });

  useEffect(() => {
    if (userPreferences) {
      const {
        downloadsPath,
        downloadNotificationsEnabled,
        repackUpdatesNotificationsEnabled,
      } = userPreferences;

      window.electron.getDefaultDownloadsPath().then((defaultDownloadsPath) => {
        setForm((prev) => ({
          ...prev,
          downloadsPath: downloadsPath ?? defaultDownloadsPath,
          downloadNotificationsEnabled,
          repackUpdatesNotificationsEnabled,
        }));
      });
    }
  }, [userPreferences]);

  const { t } = useTranslation("settings");

  const handleChange = (values: Partial<typeof form>) => {
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
      updateUserPreferences({ downloadsPath: path });
    }
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
    </>
  );
}
