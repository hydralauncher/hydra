import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField, TextField } from "@renderer/components";
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

  const formatLimitInputValue = (
    value: number,
    useMegabytes: boolean
  ): string => {
    const unitValue = useMegabytes ? value / (1024 * 1024) : (value * 8) / 1e6;
    return Number.isInteger(unitValue)
      ? `${unitValue}`
      : `${Number(unitValue.toFixed(2))}`;
  };

  const parseLimitInputToBytesPerSecond = (
    value: string,
    useMegabytes: boolean
  ): number | null | undefined => {
    const trimmed = value.trim();

    if (!trimmed) return null;

    const parsed = Number.parseFloat(trimmed);
    if (Number.isNaN(parsed)) return undefined;
    if (parsed <= 0) return null;

    return useMegabytes
      ? Math.floor(parsed * 1024 * 1024)
      : Math.floor((parsed * 1e6) / 8);
  };

  const [form, setForm] = useState({
    useNativeHttpDownloader: true,
    seedAfterDownloadComplete: false,
    showDownloadSpeedInMegabytes: false,
    extractFilesByDefault: true,
    createStartMenuShortcut: true,
    maxDownloadSpeedMegabytes: "",
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
      maxDownloadSpeedMegabytes:
        typeof userPreferences.maxDownloadSpeedBytesPerSecond === "number" &&
        userPreferences.maxDownloadSpeedBytesPerSecond > 0
          ? formatLimitInputValue(
              userPreferences.maxDownloadSpeedBytesPerSecond,
              userPreferences.showDownloadSpeedInMegabytes ?? false
            )
          : "",
    });
  }, [userPreferences]);

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  const handleMaxDownloadSpeedBlur = () => {
    const parsedBytesPerSecond = parseLimitInputToBytesPerSecond(
      form.maxDownloadSpeedMegabytes,
      form.showDownloadSpeedInMegabytes
    );

    if (parsedBytesPerSecond === undefined) {
      setForm((prev) => ({ ...prev, maxDownloadSpeedMegabytes: "" }));
      updateUserPreferences({ maxDownloadSpeedBytesPerSecond: null });
      return;
    }

    if (parsedBytesPerSecond === null) {
      setForm((prev) => ({ ...prev, maxDownloadSpeedMegabytes: "" }));
      updateUserPreferences({ maxDownloadSpeedBytesPerSecond: null });
      return;
    }

    const nextLimitValue = formatLimitInputValue(
      parsedBytesPerSecond,
      form.showDownloadSpeedInMegabytes
    );
    setForm((prev) => ({ ...prev, maxDownloadSpeedMegabytes: nextLimitValue }));
    updateUserPreferences({
      maxDownloadSpeedBytesPerSecond: parsedBytesPerSecond,
    });
  };

  const handleSpeedUnitChange = () => {
    const nextUseMegabytes = !form.showDownloadSpeedInMegabytes;
    const parsedBytesPerSecond = parseLimitInputToBytesPerSecond(
      form.maxDownloadSpeedMegabytes,
      form.showDownloadSpeedInMegabytes
    );

    const nextLimitInput =
      typeof parsedBytesPerSecond === "number" && parsedBytesPerSecond > 0
        ? formatLimitInputValue(parsedBytesPerSecond, nextUseMegabytes)
        : "";

    setForm((prev) => ({
      ...prev,
      showDownloadSpeedInMegabytes: nextUseMegabytes,
      maxDownloadSpeedMegabytes: nextLimitInput,
    }));

    updateUserPreferences({
      showDownloadSpeedInMegabytes: nextUseMegabytes,
    });
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

        <TextField
          type="number"
          min="0"
          step="0.1"
          label={t("max_download_speed", {
            unit: form.showDownloadSpeedInMegabytes ? "MB/s" : "Mbps",
          })}
          hint={t("max_download_speed_hint", {
            unit: form.showDownloadSpeedInMegabytes
              ? t("max_download_speed_unit_megabytes")
              : t("max_download_speed_unit_megabits"),
          })}
          value={form.maxDownloadSpeedMegabytes}
          onChange={(event) => {
            setForm((prev) => ({
              ...prev,
              maxDownloadSpeedMegabytes: event.target.value,
            }));
          }}
          onBlur={handleMaxDownloadSpeedBlur}
          placeholder={t("max_download_speed_unlimited")}
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
          onChange={handleSpeedUnitChange}
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
