import { useEffect, useState } from "react";
import { Button, CheckboxField, TextField } from "@renderer/components";

import * as styles from "./settings.css";
import { useTranslation } from "react-i18next";
import { UserPreferences } from "@types";

const categories = ["general", "behavior", "real_debrid"];

export function Settings() {
  const [currentCategory, setCurrentCategory] = useState(categories.at(0)!);

  const [form, setForm] = useState({
    downloadsPath: "",
    downloadNotificationsEnabled: false,
    repackUpdatesNotificationsEnabled: false,
    telemetryEnabled: false,
    realDebridApiToken: null as string | null,
    preferQuitInsteadOfHiding: false,
    runAtStartup: false,
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
        realDebridApiToken: userPreferences?.realDebridApiToken ?? null,
        preferQuitInsteadOfHiding:
          userPreferences?.preferQuitInsteadOfHiding ?? false,
        runAtStartup: userPreferences?.runAtStartup ?? false,
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

  const renderCategory = () => {
    if (currentCategory === "general") {
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
        </>
      );
    }

    if (currentCategory === "real_debrid") {
      return (
        <TextField
          label={t("real_debrid_api_token_description")}
          value={form.realDebridApiToken ?? ""}
          type="password"
          onChange={(event) => {
            updateUserPreferences("realDebridApiToken", event.target.value);
          }}
          placeholder="API Token"
        />
      );
    }

    return (
      <>
        <CheckboxField
          label={t("quit_app_instead_hiding")}
          checked={form.preferQuitInsteadOfHiding}
          onChange={() =>
            updateUserPreferences(
              "preferQuitInsteadOfHiding",
              !form.preferQuitInsteadOfHiding
            )
          }
        />

        <CheckboxField
          label={t("launch_with_system")}
          onChange={() => {
            updateUserPreferences("runAtStartup", !form.runAtStartup);
            window.electron.autoLaunch(!form.runAtStartup);
          }}
          checked={form.runAtStartup}
        />
      </>
    );
  };

  return (
    <section className={styles.container}>
      <div className={styles.content}>
        <section className={styles.settingsCategories}>
          {categories.map((category) => (
            <Button
              key={category}
              theme={currentCategory === category ? "primary" : "outline"}
              onClick={() => setCurrentCategory(category)}
            >
              {t(category)}
            </Button>
          ))}
        </section>

        <h3>{t(currentCategory)}</h3>
        {renderCategory()}
      </div>
    </section>
  );
}
