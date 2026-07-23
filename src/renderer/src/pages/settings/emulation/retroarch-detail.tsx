import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  CheckCircleFillIcon,
  ChevronLeftIcon,
  DownloadIcon,
  FileDirectoryIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";

import { Button, ConfirmationModal } from "@renderer/components";
import { useRetroArchScan, useToast } from "@renderer/hooks";
import { formatBytes } from "@shared";
import type {
  RetroArchConfig,
  RetroArchCoreInstallProgress,
  RetroArchCoreName,
  RomFolder,
} from "@types";

import { RETROARCH_PLATFORM_LABELS } from "@renderer/helpers";

import { RETROARCH_EMULATOR_ICON } from "./emulator-icons";
import { EmulatorResourceRow } from "./emulator-resource-row";
import {
  LibraryStatsGrid,
  RomFoldersSection,
} from "./emulation-detail-sections";
import { installPercent } from "./setup/install-progress";
import { RetroArchRomsSection } from "./retroarch-roms-section";
import { RETROARCH_CORE_LIST, RETROARCH_LABEL } from "./retroarch-meta";
import { formatRelativeShort } from "./relative-time";

import "./emulator-detail.scss";

interface RetroArchDetailProps {
  config: RetroArchConfig;
  onBack: () => void;
  onChange: (config: RetroArchConfig) => void;
  refresh: () => Promise<RetroArchConfig | unknown>;
}

type RetroArchTab = "emulator" | "rom-folders" | "library";

export function RetroArchDetail({
  config,
  onBack,
  onChange,
  refresh,
}: Readonly<RetroArchDetailProps>) {
  const { t, i18n } = useTranslation("settings");

  const formatLastScan = (ts: number | null): string =>
    ts !== null ? formatRelativeShort(ts, i18n.language) : "—";
  const { showSuccessToast, showErrorToast } = useToast();
  const { scan, start } = useRetroArchScan();

  const [busy, setBusy] = useState(false);
  const [romsNonce, setRomsNonce] = useState(0);
  const [folderToRemove, setFolderToRemove] = useState<RomFolder | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [executableExists, setExecutableExists] = useState<boolean>(true);
  const [coreProgress, setCoreProgress] = useState<
    Partial<Record<RetroArchCoreName, RetroArchCoreInstallProgress>>
  >({});
  const [installingCores, setInstallingCores] = useState(false);

  const [activeTab, setActiveTab] = useState<RetroArchTab>("emulator");

  useEffect(() => {
    let cancelled = false;
    if (!config.executablePath) {
      setExecutableExists(false);
      return;
    }
    window.electron
      .checkRetroArchExecutable()
      .then(({ exists }) => {
        if (!cancelled) setExecutableExists(exists);
      })
      .catch(() => {
        if (!cancelled) setExecutableExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config.executablePath]);

  useEffect(() => {
    const unsubscribe = window.electron.onRetroArchCoreInstallProgress(
      (payload) => {
        setCoreProgress((prev) => ({ ...prev, [payload.core]: payload }));
      }
    );
    return unsubscribe;
  }, []);

  const handleConfirmRemoveEmulator = useCallback(async () => {
    setBusy(true);
    try {
      const next = await window.electron.removeRetroArch();
      onChange(next);
      setRemoveOpen(false);
      onBack();
    } finally {
      setBusy(false);
    }
  }, [onChange, onBack]);

  const handleRedetect = useCallback(async () => {
    setBusy(true);
    try {
      const previousPath = config.executablePath;
      const previousVersion = config.detectedVersion;
      const next = await window.electron.detectRetroArch();
      onChange(next);

      if (next.executablePath === null) {
        showErrorToast(t("redetect_not_found", { name: RETROARCH_LABEL }));
      } else if (next.executablePath !== previousPath) {
        showSuccessToast(t("redetect_path_updated"));
      } else if (
        next.detectedVersion &&
        next.detectedVersion !== previousVersion
      ) {
        showSuccessToast(
          t("redetect_version_updated", { version: next.detectedVersion })
        );
      } else {
        showSuccessToast(t("redetect_unchanged"));
      }
    } finally {
      setBusy(false);
    }
  }, [
    config.executablePath,
    config.detectedVersion,
    onChange,
    showSuccessToast,
    showErrorToast,
    t,
  ]);

  const handleBrowseExecutable = useCallback(async () => {
    const isMac = window.electron.platform === "darwin";
    const result = await window.electron.showOpenDialog({
      properties: isMac ? ["openFile", "openDirectory"] : ["openFile"],
      defaultPath: config.executablePath ?? undefined,
      filters:
        window.electron.platform === "win32"
          ? [{ name: "Executable", extensions: ["exe"] }]
          : isMac
            ? [{ name: "Application", extensions: ["app"] }]
            : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return;

    setBusy(true);
    try {
      const next = await window.electron.setRetroArchExecutablePath(
        result.filePaths[0]
      );
      if (!next) {
        showErrorToast(t("emulator_invalid_executable"));
        return;
      }
      onChange(next);
    } finally {
      setBusy(false);
    }
  }, [config.executablePath, onChange, showErrorToast, t]);

  const handleInstallCore = useCallback(
    async (core: RetroArchCoreName) => {
      if (installingCores) return;
      setInstallingCores(true);
      try {
        await window.electron.installRetroArchCore(core);
        await refresh();
      } finally {
        setInstallingCores(false);
      }
    },
    [installingCores, refresh]
  );

  const handleInstallAllCores = useCallback(async () => {
    if (installingCores) return;
    setInstallingCores(true);
    try {
      await window.electron.installAllRetroArchCores();
      await refresh();
    } finally {
      setInstallingCores(false);
    }
  }, [installingCores, refresh]);

  const handleAddFolder = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;

    const folderPath = result.filePaths[0];
    if (config.romFolders.some((f) => f.path === folderPath)) {
      showErrorToast(t("folder_already_added"));
      return;
    }

    setBusy(true);
    try {
      const next = await window.electron.addRetroArchRomFolder(
        folderPath,
        true
      );
      onChange(next);
      await start(
        next.romFolders.map((f) => ({
          path: f.path,
          scanSubfolders: f.scanSubfolders,
        }))
      );
    } finally {
      setBusy(false);
    }
  }, [config.romFolders, onChange, showErrorToast, start, t]);

  const handleChangeFolder = useCallback(
    async (folder: RomFolder) => {
      const result = await window.electron.showOpenDialog({
        properties: ["openDirectory"],
        defaultPath: folder.path,
      });
      if (result.canceled || result.filePaths.length === 0) return;

      const newPath = result.filePaths[0];
      if (newPath === folder.path) return;
      if (config.romFolders.some((f) => f.path === newPath)) {
        showErrorToast(t("folder_already_added"));
        return;
      }

      setBusy(true);
      try {
        const next = await window.electron.changeRetroArchRomFolder(
          folder.id,
          newPath
        );
        onChange(next);
        await start(
          next.romFolders.map((f) => ({
            path: f.path,
            scanSubfolders: f.scanSubfolders,
          }))
        );
      } finally {
        setBusy(false);
      }
    },
    [config.romFolders, onChange, showErrorToast, start, t]
  );

  const handleToggleSubfolders = useCallback(
    async (folder: RomFolder) => {
      setBusy(true);
      try {
        const next = await window.electron.toggleRetroArchSubfolders(
          folder.id,
          !folder.scanSubfolders
        );
        onChange(next);
      } finally {
        setBusy(false);
      }
    },
    [onChange]
  );

  const handleConfirmRemove = useCallback(async () => {
    if (!folderToRemove) return;
    setBusy(true);
    try {
      const next = await window.electron.removeRetroArchRomFolder(
        folderToRemove.id
      );
      onChange(next);
    } finally {
      setBusy(false);
      setFolderToRemove(null);
    }
  }, [folderToRemove, onChange]);

  const handleRescan = useCallback(() => {
    if (config.romFolders.length === 0) {
      showErrorToast(t("no_rom_folder"));
      return;
    }
    void start(
      config.romFolders.map((f) => ({
        path: f.path,
        scanSubfolders: f.scanSubfolders,
      }))
    );
  }, [config.romFolders, start, showErrorToast, t]);

  const lastScanNonceRef = useRef(scan.completedNonce);
  useEffect(() => {
    if (scan.completedNonce === lastScanNonceRef.current) return;
    lastScanNonceRef.current = scan.completedNonce;
    void refresh();
    setRomsNonce((n) => n + 1);
    showSuccessToast(
      t("scan_complete_toast", {
        matched: scan.result?.matched ?? 0,
        unmatched: scan.result?.unmatched ?? 0,
      })
    );
  }, [scan.completedNonce, scan.result, refresh, showSuccessToast, t]);

  const lastScanErrorRef = useRef(scan.error);
  useEffect(() => {
    if (scan.error === lastScanErrorRef.current) return;
    lastScanErrorRef.current = scan.error;
    if (scan.error) {
      showErrorToast(scan.error);
      void refresh();
    }
  }, [scan.error, refresh, showErrorToast]);

  const storageLabel = useMemo(
    () => formatBytes(config.totalSizeBytes),
    [config.totalSizeBytes]
  );
  const lastScanLabel = formatLastScan(config.lastScanAt);

  const isConfigured = config.executablePath !== null;

  const installedCoreCount = useMemo(
    () =>
      RETROARCH_CORE_LIST.filter(
        (core) => config.cores[core.name]?.installed === true
      ).length,
    [config.cores]
  );

  const coreStatusText = (core: RetroArchCoreName): string => {
    const current = coreProgress[core];
    if (current && current.phase === "downloading") {
      return t("setup_install_downloading", {
        percent: installPercent(current.loaded, current.total),
      });
    }
    if (current && current.phase === "extracting") {
      return t("setup_install_extracting");
    }
    if (current && current.phase === "error") {
      return t("setup_install_failed");
    }
    const installed = config.cores[core];
    if (installed?.installed) {
      return installed.installedAt
        ? t("retroarch_core_installed_at", {
            date: new Date(installed.installedAt).toLocaleDateString(),
          })
        : t("retroarch_core_installed");
    }
    return t("retroarch_core_not_installed");
  };

  const tabs: { id: RetroArchTab; label: string }[] = [
    { id: "emulator", label: t("tab_emulator") },
    { id: "rom-folders", label: t("tab_rom_folders") },
    { id: "library", label: t("tab_library") },
  ];

  return (
    <div className="emulator-detail">
      <button
        type="button"
        className="emulator-detail__breadcrumb"
        onClick={onBack}
      >
        <ChevronLeftIcon size={12} />
        <span>{t("back_to_emulation")}</span>
      </button>

      <section className="emulator-detail__hero">
        <div className="emulator-detail__hero-text">
          <h2 className="emulator-detail__hero-title">{RETROARCH_LABEL}</h2>
          <div className="emulator-detail__hero-meta">
            <img
              src={RETROARCH_EMULATOR_ICON}
              alt=""
              className="emulator-detail__hero-icon"
              aria-hidden="true"
            />
            <span className="emulator-detail__hero-detected">
              {isConfigured
                ? t("detected", { name: RETROARCH_LABEL })
                : t("not_detected")}
            </span>
            {config.detectedVersion && (
              <span className="emulator-detail__hero-version">
                v{config.detectedVersion}
              </span>
            )}
            <span className="emulator-detail__dot" />
            <span className="emulator-detail__hero-count">
              <span className="emulator-detail__hero-count-dot" />
              {t("games_found_other", { count: config.totalFiles })}
            </span>
          </div>
        </div>
        <div className="emulator-detail__hero-actions">
          <Button
            theme="primary"
            onClick={handleRescan}
            disabled={busy || scan.active}
          >
            <SyncIcon
              size={16}
              className={
                scan.active
                  ? "emulator-detail__redetect-icon--spinning"
                  : undefined
              }
            />
            <span>{t("rescan_library")}</span>
          </Button>
        </div>
      </section>

      <div className="emulator-detail__tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={cn("emulator-detail__tab", {
              "emulator-detail__tab--active": activeTab === tab.id,
            })}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "emulator" && (
        <>
          <EmulatorResourceRow
            title={t("executable_path_title")}
            description={t("executable_path_description")}
            detected={isConfigured && executableExists}
            statusLabel={
              isConfigured
                ? executableExists
                  ? t("synced")
                  : t("executable_missing")
                : t("not_detected")
            }
            path={{
              text: config.executablePath,
              placeholder: t("select_executable_placeholder"),
              onClick: handleBrowseExecutable,
              disabled: busy,
              title: t("change_executable_path"),
            }}
            actions={
              <>
                <Button
                  theme="outline"
                  onClick={handleRedetect}
                  disabled={busy}
                >
                  <SyncIcon
                    size={13}
                    className={
                      busy
                        ? "emulator-detail__redetect-icon--spinning"
                        : undefined
                    }
                  />
                  <span>{t("re_detect")}</span>
                </Button>
                <Button
                  theme="primary"
                  onClick={handleBrowseExecutable}
                  disabled={busy}
                >
                  <FileDirectoryIcon size={16} />
                  <span>{t("browse")}</span>
                </Button>
              </>
            }
          />

          <section className="emulator-detail__section">
            <header className="emulator-detail__section-header">
              <div className="emulator-detail__section-text">
                <h3>{t("retroarch_cores_section_title")}</h3>
                <p>
                  {t("retroarch_cores_section_description", {
                    installed: installedCoreCount,
                    total: RETROARCH_CORE_LIST.length,
                  })}
                </p>
              </div>
              <Button
                theme="outline"
                onClick={handleInstallAllCores}
                disabled={installingCores}
              >
                <DownloadIcon size={14} />
                <span>
                  {installingCores
                    ? t("retroarch_downloading_cores")
                    : t("retroarch_download_all_cores")}
                </span>
              </Button>
            </header>

            <div className="emulator-detail__folders">
              {RETROARCH_CORE_LIST.map((core) => {
                const installed = config.cores[core.name]?.installed === true;
                return (
                  <div className="emulator-detail__row" key={core.name}>
                    {installed ? (
                      <CheckCircleFillIcon size={24} />
                    ) : (
                      <DownloadIcon size={24} />
                    )}
                    <div className="emulator-detail__folder-info">
                      <span className="emulator-detail__folder-path">
                        {core.label}
                        {" · "}
                        {core.platforms}
                      </span>
                      <div className="emulator-detail__folder-meta">
                        <span>{coreStatusText(core.name)}</span>
                      </div>
                    </div>
                    <Button
                      theme="outline"
                      onClick={() => handleInstallCore(core.name)}
                      disabled={installingCores}
                    >
                      {installed
                        ? t("retroarch_core_update")
                        : t("retroarch_core_download")}
                    </Button>
                  </div>
                );
              })}
            </div>
          </section>

          {isConfigured && (
            <button
              type="button"
              className="emulator-detail__remove-emulator"
              onClick={() => setRemoveOpen(true)}
              disabled={busy || scan.active}
            >
              <TrashIcon size={14} />
              <span>{t("remove_emulator")}</span>
            </button>
          )}
        </>
      )}

      {activeTab === "rom-folders" && (
        <RomFoldersSection
          folders={config.romFolders}
          disabled={busy || scan.active}
          formatLastScan={formatLastScan}
          onAddFolder={handleAddFolder}
          onToggleSubfolders={handleToggleSubfolders}
          onRemoveFolder={setFolderToRemove}
          onChangeFolder={handleChangeFolder}
        />
      )}

      {activeTab === "library" && (
        <>
          <section className="emulator-detail__section">
            <header className="emulator-detail__section-header">
              <div className="emulator-detail__section-text">
                <h3>{t("library_section_title")}</h3>
                <p>
                  {t("library_section_description", {
                    system: RETROARCH_LABEL,
                  })}
                </p>
              </div>
              <Button
                theme="outline"
                onClick={handleRescan}
                disabled={busy || scan.active}
              >
                <SyncIcon size={13} />
                <span>{t("rescan")}</span>
              </Button>
            </header>

            {scan.active && (
              <div className="emulator-detail__folder-meta">
                <SyncIcon
                  size={13}
                  className="emulator-detail__redetect-icon--spinning"
                />
                <span>
                  {t("retroarch_scan_in_progress", {
                    percent: Math.floor(scan.percent),
                  })}
                </span>
              </div>
            )}

            <LibraryStatsGrid
              systemLabel={RETROARCH_LABEL}
              totalFiles={config.totalFiles}
              storageLabel={storageLabel}
              lastScanLabel={lastScanLabel}
              romFoldersCount={config.romFolders.length}
            />

            <div className="emulator-detail__folder-meta">
              {Object.entries(RETROARCH_PLATFORM_LABELS).map(
                ([platform, label], index) => (
                  <span key={platform}>
                    {index > 0 && <span className="emulator-detail__dot" />}
                    {label}{" "}
                    {config.perPlatformCounts[
                      platform as keyof typeof config.perPlatformCounts
                    ] ?? 0}
                  </span>
                )
              )}
            </div>
          </section>

          <RetroArchRomsSection refreshKey={romsNonce} />
        </>
      )}

      <ConfirmationModal
        visible={folderToRemove !== null}
        title={t("remove_rom_folder_title")}
        descriptionText={t("remove_rom_folder_description", {
          path: folderToRemove?.path ?? "",
        })}
        confirmButtonLabel={t("remove")}
        cancelButtonLabel={t("cancel_remove")}
        onConfirm={handleConfirmRemove}
        onClose={() => setFolderToRemove(null)}
        buttonsIsDisabled={busy}
      />

      <ConfirmationModal
        visible={removeOpen}
        title={t("remove_emulator_title", { name: RETROARCH_LABEL })}
        descriptionText={t("remove_emulator_description", {
          name: RETROARCH_LABEL,
        })}
        confirmButtonLabel={t("remove")}
        cancelButtonLabel={t("cancel_remove")}
        onConfirm={handleConfirmRemoveEmulator}
        onClose={() => setRemoveOpen(false)}
        buttonsIsDisabled={busy}
      />
    </div>
  );
}
