import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField, SelectField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { NetworkInterface, UserPreferences } from "@types";
import { SettingsDownloadSources } from "./settings-download-sources";

import "./settings-general.scss";

export function SettingsContextDownloads() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

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
    seedAfterDownloadComplete: false,
    showDownloadSpeedInMegabytes: false,
    extractFilesByDefault: true,
    createStartMenuShortcut: true,
    maxDownloadSpeedMegabytes: "",
    deleteArchiveFilesAfterExtractionByDefault: false,
    torrentNetworkInterface: "",
    torrentTrackerListUrl: "",
    torrentGlobalMaxConnections: "",
    torrentPerTorrentMaxConnections: "",
    torrentMaxHalfOpenConnections: "",
    torrentAllowTcp: true,
    torrentAllowUtp: true,
    torrentEnableTracker: true,
    torrentEnableDht: true,
    torrentEnablePex: true,
    torrentListenPort: "",
    torrentUseUpnp: false,
  });

  const [networkInterfaces, setNetworkInterfaces] = useState<
    NetworkInterface[]
  >([]);

  useEffect(() => {
    globalThis.electron
      .getNetworkInterfaces()
      .then(setNetworkInterfaces)
      .catch(() => setNetworkInterfaces([]));
  }, []);

  useEffect(() => {
    if (!userPreferences) return;

    setForm({
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
      deleteArchiveFilesAfterExtractionByDefault:
        userPreferences.deleteArchiveFilesAfterExtractionByDefault ?? false,
      torrentNetworkInterface: userPreferences.torrentNetworkInterface ?? "",
      torrentTrackerListUrl: userPreferences.torrentTrackerListUrl ?? "",
      torrentGlobalMaxConnections:
        userPreferences.torrentGlobalMaxConnections?.toString() ?? "",
      torrentPerTorrentMaxConnections:
        userPreferences.torrentPerTorrentMaxConnections?.toString() ?? "",
      torrentMaxHalfOpenConnections:
        userPreferences.torrentMaxHalfOpenConnections?.toString() ?? "",
      torrentAllowTcp: userPreferences.torrentAllowTcp ?? true,
      torrentAllowUtp: userPreferences.torrentAllowUtp ?? true,
      torrentEnableTracker: userPreferences.torrentEnableTracker ?? true,
      torrentEnableDht: userPreferences.torrentEnableDht ?? true,
      torrentEnablePex: userPreferences.torrentEnablePex ?? true,
      torrentListenPort: userPreferences.torrentListenPort?.toString() ?? "",
      torrentUseUpnp: userPreferences.torrentUseUpnp ?? false,
    });
  }, [userPreferences]);

  const networkInterfaceOptions = useMemo(() => {
    const options = [
      { key: "default", value: "", label: t("network_interface_default") },
      ...networkInterfaces.map((networkInterface) => {
        const ipv4 = networkInterface.addresses.find(
          (address) => !address.includes(":")
        );

        return {
          key: networkInterface.name,
          value: networkInterface.name,
          label: ipv4
            ? `${networkInterface.name} (${ipv4})`
            : networkInterface.name,
        };
      }),
    ];

    const selected = form.torrentNetworkInterface;
    if (selected && !options.some((option) => option.value === selected)) {
      options.push({
        key: selected,
        value: selected,
        label: `${selected} (${t("network_interface_unavailable")})`,
      });
    }

    return options;
  }, [networkInterfaces, form.torrentNetworkInterface, t]);

  const parseNumberInput = (value: string): number | null | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isNaN(parsed)) return undefined;
    if (parsed <= 0) return null;
    return parsed;
  };

  const buildNumberBlurHandler =
    (fieldName: keyof typeof form, preferenceKey: string) => () => {
      const currentValue = form[fieldName] as string;
      const parsed = parseNumberInput(currentValue);

      if (parsed === undefined) {
        setForm((prev) => ({ ...prev, [fieldName]: "" }));
        updateUserPreferences({ [preferenceKey]: null });
        return;
      }

      if (parsed === null) {
        setForm((prev) => ({ ...prev, [fieldName]: "" }));
        updateUserPreferences({ [preferenceKey]: null });
        return;
      }

      updateUserPreferences({ [preferenceKey]: parsed });
    };

  const handleChange = (values: Partial<UserPreferences>) => {
    setForm((prev) => ({
      ...prev,
      ...(values as Record<string, string | boolean>),
    }));
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

        <div className="settings-general__network-interface">
          <SelectField
            label={t("network_interface")}
            value={form.torrentNetworkInterface}
            onChange={(event) =>
              handleChange({ torrentNetworkInterface: event.target.value })
            }
            options={networkInterfaceOptions}
          />
          <small className="settings-general__network-interface-hint">
            {t("network_interface_hint")}
          </small>
        </div>

        <TextField
          label={t("torrent_tracker_list_url")}
          hint={t("torrent_tracker_list_url_hint")}
          placeholder="https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_all.txt"
          value={form.torrentTrackerListUrl}
          onChange={(event) =>
            handleChange({ torrentTrackerListUrl: event.target.value })
          }
        />

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

        <CheckboxField
          label={t("delete_archive_files_after_extraction")}
          checked={form.deleteArchiveFilesAfterExtractionByDefault}
          onChange={() =>
            handleChange({
              deleteArchiveFilesAfterExtractionByDefault:
                !form.deleteArchiveFilesAfterExtractionByDefault,
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
        <h3>{t("connection_limits")}</h3>

        <TextField
          type="number"
          min="0"
          label={t("global_max_connections")}
          hint={t("global_max_connections_hint")}
          value={form.torrentGlobalMaxConnections}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              torrentGlobalMaxConnections: event.target.value,
            }))
          }
          onBlur={buildNumberBlurHandler(
            "torrentGlobalMaxConnections",
            "torrentGlobalMaxConnections"
          )}
          placeholder={t("max_download_speed_unlimited")}
        />

        <TextField
          type="number"
          min="0"
          label={t("per_torrent_max_connections")}
          hint={t("per_torrent_max_connections_hint")}
          value={form.torrentPerTorrentMaxConnections}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              torrentPerTorrentMaxConnections: event.target.value,
            }))
          }
          onBlur={buildNumberBlurHandler(
            "torrentPerTorrentMaxConnections",
            "torrentPerTorrentMaxConnections"
          )}
          placeholder={t("max_download_speed_unlimited")}
        />

        <TextField
          type="number"
          min="0"
          label={t("max_half_open_connections")}
          hint={t("max_half_open_connections_hint")}
          value={form.torrentMaxHalfOpenConnections}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              torrentMaxHalfOpenConnections: event.target.value,
            }))
          }
          onBlur={buildNumberBlurHandler(
            "torrentMaxHalfOpenConnections",
            "torrentMaxHalfOpenConnections"
          )}
          placeholder={t("max_download_speed_unlimited")}
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("transport_protocols")}</h3>

        <CheckboxField
          label={t("allow_tcp_connections")}
          checked={form.torrentAllowTcp}
          onChange={() =>
            handleChange({ torrentAllowTcp: !form.torrentAllowTcp })
          }
        />

        <CheckboxField
          label={t("allow_utp_connections")}
          checked={form.torrentAllowUtp}
          onChange={() =>
            handleChange({ torrentAllowUtp: !form.torrentAllowUtp })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("peer_discovery")}</h3>

        <CheckboxField
          label={t("enable_tracker_communications")}
          checked={form.torrentEnableTracker}
          onChange={() =>
            handleChange({
              torrentEnableTracker: !form.torrentEnableTracker,
            })
          }
        />

        <CheckboxField
          label={t("enable_dht")}
          checked={form.torrentEnableDht}
          onChange={() =>
            handleChange({ torrentEnableDht: !form.torrentEnableDht })
          }
        />

        <CheckboxField
          label={t("enable_pex")}
          checked={form.torrentEnablePex}
          onChange={() =>
            handleChange({ torrentEnablePex: !form.torrentEnablePex })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("port_and_firewall")}</h3>

        <TextField
          type="number"
          min="1"
          max="65535"
          label={t("listen_port")}
          hint={t("listen_port_hint")}
          value={form.torrentListenPort}
          onChange={(event) =>
            setForm((prev) => ({
              ...prev,
              torrentListenPort: event.target.value,
            }))
          }
          onBlur={buildNumberBlurHandler(
            "torrentListenPort",
            "torrentListenPort"
          )}
          placeholder="6881"
        />

        <CheckboxField
          label={t("use_upnp")}
          checked={form.torrentUseUpnp}
          onChange={() =>
            handleChange({ torrentUseUpnp: !form.torrentUseUpnp })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("download_sources")}</h3>
        <SettingsDownloadSources />
      </div>
    </div>
  );
}
