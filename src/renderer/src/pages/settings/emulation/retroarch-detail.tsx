import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircleFillIcon,
  DownloadIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useRetroArchScan, useToast } from "@renderer/hooks";
import { formatBytes } from "@shared";
import type {
  RetroArchConfig,
  RetroArchCoreInstallProgress,
  RetroArchCoreName,
  RomFolder,
} from "@types";

import {
  RETROARCH_PLATFORM_LABELS,
  showExecutableOpenDialog,
} from "@renderer/helpers";

import { RETROARCH_EMULATOR_ICON } from "./emulator-icons";
import {
  DetailHeader,
  DetailRemoveModals,
  DetailTabBar,
  ExecutableRow,
  LibraryStatsGrid,
  notifyRedetectOutcome,
  RomFoldersSection,
} from "./emulation-detail-sections";
import { RetroArchRomsSection } from "./retroarch-roms-section";
import {
  RETROARCH_CORE_LIST,
  RETROARCH_LABEL,
  retroArchCoreStatusText,
} from "./retroarch-meta";
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
      const previous = {
        executablePath: config.executablePath,
        detectedVersion: config.detectedVersion,
      };
      const next = await window.electron.detectRetroArch();
      onChange(next);
      notifyRedetectOutcome(
        next,
        previous,
        RETROARCH_LABEL,
        t,
        showErrorToast,
        showSuccessToast
      );
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
    const result = await showExecutableOpenDialog(config.executablePath);
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

  const coreStatusText = (core: RetroArchCoreName): string =>
    retroArchCoreStatusText(t, core, config, coreProgress);

  const tabs: { id: RetroArchTab; label: string }[] = [
    { id: "emulator", label: t("tab_emulator") },
    { id: "rom-folders", label: t("tab_rom_folders") },
    { id: "library", label: t("tab_library") },
  ];

  return (
    <div className="emulator-detail">
      <DetailHeader
        title={RETROARCH_LABEL}
        icon={RETROARCH_EMULATOR_ICON}
        detectedName={RETROARCH_LABEL}
        isConfigured={isConfigured}
        detectedVersion={config.detectedVersion}
        totalFiles={config.totalFiles}
        rescanDisabled={busy || scan.active}
        rescanSpinning={scan.active}
        onBack={onBack}
        onRescan={handleRescan}
      />

      <DetailTabBar tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "emulator" && (
        <>
          <ExecutableRow
            executablePath={config.executablePath}
            executableExists={executableExists}
            busy={busy}
            onRedetect={handleRedetect}
            onBrowse={handleBrowseExecutable}
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

      <DetailRemoveModals
        emulatorName={RETROARCH_LABEL}
        folderToRemove={folderToRemove}
        removeEmulatorOpen={removeOpen}
        busy={busy}
        onConfirmRemoveFolder={handleConfirmRemove}
        onCloseRemoveFolder={() => setFolderToRemove(null)}
        onConfirmRemoveEmulator={handleConfirmRemoveEmulator}
        onCloseRemoveEmulator={() => setRemoveOpen(false)}
      />
    </div>
  );
}
