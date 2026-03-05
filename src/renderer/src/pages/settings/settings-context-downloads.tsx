import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import { SettingsDownloadSources } from "./settings-download-sources";

import "./settings-general.scss";

export function SettingsContextDownloads() {
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

  const [form, setForm] = useState({
    useNativeHttpDownloader: true,
    seedAfterDownloadComplete: false,
    showDownloadSpeedInMegabytes: false,
    extractFilesByDefault: true,
    createStartMenuShortcut: true,
  });

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
      useNativeHttpDownloader: userPreferences.useNativeHttpDownloader ?? true,
      seedAfterDownloadComplete:
        userPreferences.seedAfterDownloadComplete ?? false,
      showDownloadSpeedInMegabytes:
        userPreferences.showDownloadSpeedInMegabytes ?? false,
      extractFilesByDefault: userPreferences.extractFilesByDefault ?? true,
      createStartMenuShortcut: userPreferences.createStartMenuShortcut ?? true,
    });
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("download_behavior")}</h3>

        <CheckboxField
          label={t("use_native_http_downloader")}
          checked={form.useNativeHttpDownloader}
          disabled={hasActiveDownload}
          onChange={() =>
            handleChange({
              useNativeHttpDownloader: !form.useNativeHttpDownloader,
            })
          }
        />

        {hasActiveDownload && (
          <p className="settings-general__disabled-hint">
            {t("cannot_change_downloader_while_downloading")}
          </p>
        )}

        <CheckboxField
          label={t("seed_after_download_complete")}
          checked={form.seedAfterDownloadComplete}
          onChange={() =>
            handleChange({
              seedAfterDownloadComplete: !form.seedAfterDownloadComplete,
            })
          }
        />

        <CheckboxField
          label={t("extract_files_by_default")}
          checked={form.extractFilesByDefault}
          onChange={() =>
            handleChange({
              extractFilesByDefault: !form.extractFilesByDefault,
            })
          }
        />

        <CheckboxField
          label={t("show_download_speed_in_megabytes")}
          checked={form.showDownloadSpeedInMegabytes}
          onChange={() =>
            handleChange({
              showDownloadSpeedInMegabytes: !form.showDownloadSpeedInMegabytes,
            })
          }
        />

        {window.electron.platform === "win32" && (
          <CheckboxField
            label={t("create_shortcuts_on_download")}
            checked={form.createStartMenuShortcut}
            onChange={() =>
              handleChange({
                createStartMenuShortcut: !form.createStartMenuShortcut,
              })
            }
          />
        )}
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("download_sources")}</h3>
        <SettingsDownloadSources />
      </div>
    </div>
  );
}
