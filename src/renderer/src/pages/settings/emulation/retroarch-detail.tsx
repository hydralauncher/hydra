import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileDirectoryIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";

import { Button, RetroArchScanIndicator } from "@renderer/components";
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
import { EmulatorResourceRow } from "./emulator-resource-row";
import {
  RETROARCH_CORE_LIST,
  RETROARCH_CORES_LINE,
  RETROARCH_LABEL,
  retroArchCoreStatusText,
} from "./retroarch-meta";
import { formatRelativeShort } from "./relative-time";
import { SETTINGS_RETROARCH_TAB_STORAGE_KEY } from "@renderer/session-state";

import "./emulator-detail.scss";

interface RetroArchDetailProps {
  config: RetroArchConfig;
  onBack: () => void;
  onChange: (config: RetroArchConfig) => void;
  refresh: () => Promise<unknown>;
}

type RetroArchTab = "emulator" | "rom-folders" | "library";

const RETROARCH_TABS: RetroArchTab[] = ["emulator", "rom-folders", "library"];

const readStoredTab = (): RetroArchTab => {
  const stored = localStorage.getItem(SETTINGS_RETROARCH_TAB_STORAGE_KEY);
  return stored && (RETROARCH_TABS as string[]).includes(stored)
    ? (stored as RetroArchTab)
    : "emulator";
};

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

  const [activeTab, setActiveTab] = useState<RetroArchTab>(readStoredTab);

  useEffect(() => {
    localStorage.setItem(SETTINGS_RETROARCH_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

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

  const handleRedetectCores = useCallback(async () => {
    if (installingCores) return;
    setInstallingCores(true);
    try {
      const rescanned = await window.electron.setRetroArchCoresDir(
        config.coresDir
      );
      onChange(rescanned);
      const results = await window.electron.installAllRetroArchCores();
      await refresh();

      const failed = results.filter((result) => !result.ok).length;
      if (failed > 0) {
        showErrorToast(t("retroarch_cores_install_failed", { count: failed }));
        return;
      }

      const next = await window.electron.getRetroArchConfig();
      const installed = Object.values(next.cores).filter(
        (core) => core.installed
      ).length;
      showSuccessToast(
        installed === RETROARCH_CORE_LIST.length
          ? t("retroarch_cores_ready")
          : t("retroarch_cores_installed_count", {
              installed,
              total: RETROARCH_CORE_LIST.length,
            })
      );
    } finally {
      setInstallingCores(false);
    }
  }, [
    config.coresDir,
    installingCores,
    onChange,
    refresh,
    showErrorToast,
    showSuccessToast,
    t,
  ]);

  const handleChangeCoresDir = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
      defaultPath: config.coresDir ?? undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const next = await window.electron.setRetroArchCoresDir(
      result.filePaths[0]
    );
    onChange(next);
  }, [config.coresDir, onChange]);

  const handleResetCoresDir = useCallback(async () => {
    const next = await window.electron.setRetroArchCoresDir(null);
    onChange(next);
  }, [onChange]);

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
        })),
        { openModal: true }
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
          })),
          { openModal: true }
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
      })),
      { openModal: true }
    );
  }, [config.romFolders, start, showErrorToast, t]);

  const lastSettledNonceRef = useRef(scan.settledNonce);
  useEffect(() => {
    if (scan.settledNonce === lastSettledNonceRef.current) return;
    lastSettledNonceRef.current = scan.settledNonce;
    void refresh();
    setRomsNonce((n) => n + 1);
  }, [scan.settledNonce, refresh]);

  const lastScanNonceRef = useRef(scan.completedNonce);
  useEffect(() => {
    if (scan.completedNonce === lastScanNonceRef.current) return;
    lastScanNonceRef.current = scan.completedNonce;
    showSuccessToast(
      t("scan_complete_toast", {
        matched: scan.result?.matched ?? 0,
        unmatched: scan.result?.unmatched ?? 0,
      })
    );
  }, [scan.completedNonce, scan.result, showSuccessToast, t]);

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

  const allCoresInstalled = installedCoreCount === RETROARCH_CORE_LIST.length;

  const busyCore = RETROARCH_CORE_LIST.find((core) => {
    const current = coreProgress[core.name];
    return current?.phase === "downloading" || current?.phase === "extracting";
  });

  let coresRowStatus = t("retroarch_cores_installed_count", {
    installed: installedCoreCount,
    total: RETROARCH_CORE_LIST.length,
  });
  if (busyCore) {
    coresRowStatus = `${busyCore.label}: ${retroArchCoreStatusText(
      t,
      busyCore.name,
      config,
      coreProgress
    )}`;
  } else if (allCoresInstalled) {
    coresRowStatus = t("retroarch_cores_ready");
  }

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

      <RetroArchScanIndicator variant="section" />

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

          <EmulatorResourceRow
            title={t("retroarch_cores_section_title")}
            description={RETROARCH_CORES_LINE}
            detected={allCoresInstalled}
            statusLabel={coresRowStatus}
            headerAccessory={
              config.coresDir ? (
                <button
                  type="button"
                  className="emulator-detail__res-link"
                  onClick={handleResetCoresDir}
                  disabled={busy || installingCores}
                >
                  {t("retroarch_cores_folder_reset")}
                </button>
              ) : undefined
            }
            path={{
              text: config.coresDir,
              placeholder: t("retroarch_cores_folder_default"),
              onClick: handleChangeCoresDir,
              disabled: busy || installingCores,
              title: t("retroarch_cores_folder_change"),
            }}
            actions={
              <>
                <Button
                  theme="outline"
                  onClick={handleRedetectCores}
                  disabled={busy || installingCores}
                >
                  <SyncIcon
                    size={13}
                    className={
                      installingCores
                        ? "emulator-detail__redetect-icon--spinning"
                        : undefined
                    }
                  />
                  <span>{t("re_detect")}</span>
                </Button>
                <Button
                  theme="primary"
                  onClick={handleChangeCoresDir}
                  disabled={busy || installingCores}
                >
                  <FileDirectoryIcon size={16} />
                  <span>{t("browse")}</span>
                </Button>
              </>
            }
          />

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

          {config.lastScanAt !== null && (
            <RetroArchRomsSection refreshKey={romsNonce} />
          )}
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
