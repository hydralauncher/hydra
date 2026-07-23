import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  ChevronLeftIcon,
  FileDirectoryIcon,
  InfoIcon,
  SyncIcon,
  TrashIcon,
} from "@primer/octicons-react";

import {
  Button,
  ClassicsScanIndicator,
  ConfirmationModal,
} from "@renderer/components";
import { useClassicsScan, useToast } from "@renderer/hooks";
import { formatBytes } from "@shared";
import type { EmulatorConfig, RomFolder } from "@types";

import { KNOWN_BINARY_LABELS } from "./known-binary-labels";
import { EMULATOR_ICONS } from "./emulator-icons";
import { BiosSection } from "./bios-section";
import { FirmwareSection } from "./firmware-section";
import { EmulatorResourceRow } from "./emulator-resource-row";
import {
  LibraryStatsGrid,
  RomFoldersSection,
} from "./emulation-detail-sections";
import { MemoryCardsSection } from "./memory-cards-section";
import { CloudSavesSection } from "./cloud-saves-section";
import { RomsDetectedSection } from "./roms-detected-section";
import { formatRelativeShort } from "./relative-time";

import "./emulator-detail.scss";

interface EmulatorDetailProps {
  config: EmulatorConfig;
  systemLabel: string;
  onBack: () => void;
  onChange: (config: EmulatorConfig) => void;
  refresh: () => Promise<EmulatorConfig | unknown>;
}

type EmulatorTab = "emulator" | "rom-folders" | "memory-cards" | "library";

export function EmulatorDetail({
  config,
  systemLabel,
  onBack,
  onChange,
  refresh,
}: Readonly<EmulatorDetailProps>) {
  const { t, i18n } = useTranslation("settings");

  const formatLastScan = (ts: number | null): string =>
    ts !== null ? formatRelativeShort(ts, i18n.language) : "—";
  const { showSuccessToast, showErrorToast } = useToast();
  const { scan, start } = useClassicsScan();

  const [busy, setBusy] = useState(false);
  const [cloudNonce, setCloudNonce] = useState(0);
  const [romsNonce, setRomsNonce] = useState(0);
  const [folderToRemove, setFolderToRemove] = useState<RomFolder | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [executableExists, setExecutableExists] = useState<boolean>(true);

  const supportsMemoryCards =
    config.system === "ps2" || config.system === "ps1";
  const supportsBios = supportsMemoryCards;
  const supportsFirmware = config.system === "ps3";

  const [activeTab, setActiveTab] = useState<EmulatorTab>("emulator");

  useEffect(() => {
    let cancelled = false;
    if (!config.executablePath) {
      setExecutableExists(false);
      return;
    }
    window.electron
      .checkEmulatorExecutable(config.system)
      .then(({ exists }) => {
        if (!cancelled) setExecutableExists(exists);
      })
      .catch(() => {
        if (!cancelled) setExecutableExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config.system, config.executablePath]);

  const handleConfirmRemoveEmulator = useCallback(async () => {
    setBusy(true);
    try {
      const next = await window.electron.removeEmulator(config.system);
      onChange(next);
      setRemoveOpen(false);
      onBack();
    } finally {
      setBusy(false);
    }
  }, [config.system, onChange, onBack]);

  const binaryName = KNOWN_BINARY_LABELS[config.binary];
  const binaryIcon = EMULATOR_ICONS[config.binary];

  const handleRedetect = useCallback(async () => {
    setBusy(true);
    try {
      const previousPath = config.executablePath;
      const previousVersion = config.detectedVersion;
      const next = await window.electron.detectEmulator(config.system);
      onChange(next);

      if (next.executablePath === null) {
        showErrorToast(t("redetect_not_found", { name: binaryName }));
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
    config.system,
    config.executablePath,
    config.detectedVersion,
    onChange,
    showSuccessToast,
    showErrorToast,
    t,
    binaryName,
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
      const preview = await window.electron.previewEmulatorExecutable(
        config.system,
        result.filePaths[0]
      );
      if (!preview) {
        showErrorToast(t("emulator_invalid_executable"));
        return;
      }
      const next = await window.electron.setEmulatorExecutablePath(
        config.system,
        result.filePaths[0]
      );
      onChange(next);
    } finally {
      setBusy(false);
    }
  }, [config.system, config.executablePath, onChange, showErrorToast, t]);

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

    await start(config.system, [{ path: folderPath, scanSubfolders: true }], {
      openModal: true,
    });
  }, [config.romFolders, config.system, start, showErrorToast, t]);

  const handleToggleSubfolders = useCallback(
    async (folder: RomFolder) => {
      setBusy(true);
      try {
        const next = await window.electron.toggleRomFolderSubfolders(
          config.system,
          folder.id,
          !folder.scanSubfolders
        );
        onChange(next);
      } finally {
        setBusy(false);
      }
    },
    [config.system, onChange]
  );

  const handleConfirmRemove = useCallback(async () => {
    if (!folderToRemove) return;
    setBusy(true);
    try {
      const next = await window.electron.removeRomFolder(
        config.system,
        folderToRemove.id
      );
      onChange(next);
    } finally {
      setBusy(false);
      setFolderToRemove(null);
    }
  }, [config.system, folderToRemove, onChange]);

  const handleRescan = useCallback(() => {
    if (config.romFolders.length === 0) {
      showErrorToast(t("no_rom_folder"));
      return;
    }
    void start(
      config.system,
      config.romFolders.map((f) => ({
        path: f.path,
        scanSubfolders: f.scanSubfolders,
      })),
      { openModal: true }
    );
  }, [config.romFolders, config.system, start, showErrorToast, t]);

  const lastScanNonceRef = useRef(scan.completedNonce);
  useEffect(() => {
    if (scan.completedNonce === lastScanNonceRef.current) return;
    lastScanNonceRef.current = scan.completedNonce;
    if (scan.completedSystem !== config.system) return;
    void refresh();
    setRomsNonce((n) => n + 1);
    showSuccessToast(
      t("scan_complete_toast", {
        matched: scan.result?.matched ?? 0,
        unmatched: scan.result?.unmatched ?? 0,
      })
    );
  }, [
    scan.completedNonce,
    scan.completedSystem,
    scan.result,
    config.system,
    refresh,
    showSuccessToast,
    t,
  ]);

  const storageLabel = useMemo(
    () => formatBytes(config.totalSizeBytes),
    [config.totalSizeBytes]
  );
  const lastScanLabel = formatLastScan(config.lastScanAt);

  const isConfigured = config.executablePath !== null;

  const tabs: { id: EmulatorTab; label: string }[] = [
    { id: "emulator", label: t("tab_emulator") },
    { id: "rom-folders", label: t("tab_rom_folders") },
    ...(supportsMemoryCards
      ? [{ id: "memory-cards" as const, label: t("tab_memory_card_backups") }]
      : []),
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
          <h2 className="emulator-detail__hero-title">{systemLabel}</h2>
          <div className="emulator-detail__hero-meta">
            {binaryIcon && (
              <img
                src={binaryIcon}
                alt=""
                className="emulator-detail__hero-icon"
                aria-hidden="true"
              />
            )}
            <span className="emulator-detail__hero-detected">
              {isConfigured
                ? t("detected", { name: binaryName })
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

      {!supportsFirmware && (
        <p className="emulator-detail__bios-note">
          <InfoIcon size={14} />
          <span>{t("bios_note", { name: binaryName })}</span>
        </p>
      )}

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

          {supportsBios && (
            <BiosSection config={config} disabled={busy} onChange={onChange} />
          )}

          {supportsFirmware && (
            <FirmwareSection config={config} disabled={busy} />
          )}

          {isConfigured && (
            <button
              type="button"
              className="emulator-detail__remove-emulator"
              onClick={() => setRemoveOpen(true)}
              disabled={busy}
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
        />
      )}

      {activeTab === "memory-cards" && supportsMemoryCards && (
        <>
          <MemoryCardsSection
            config={config}
            onUploaded={() => setCloudNonce((n) => n + 1)}
          />
          <CloudSavesSection config={config} refreshKey={cloudNonce} />
        </>
      )}

      {activeTab === "library" && (
        <>
          <section className="emulator-detail__section">
            <header className="emulator-detail__section-header">
              <div className="emulator-detail__section-text">
                <h3>{t("library_section_title")}</h3>
                <p>
                  {t("library_section_description", { system: systemLabel })}
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

            <ClassicsScanIndicator variant="section" />

            <LibraryStatsGrid
              systemLabel={systemLabel}
              totalFiles={config.totalFiles}
              storageLabel={storageLabel}
              lastScanLabel={lastScanLabel}
              romFoldersCount={config.romFolders.length}
            />
          </section>

          <RomsDetectedSection
            system={config.system}
            systemLabel={systemLabel}
            refreshKey={romsNonce}
          />
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
        title={t("remove_emulator_title", { name: binaryName })}
        descriptionText={t("remove_emulator_description", { name: binaryName })}
        confirmButtonLabel={t("remove")}
        cancelButtonLabel={t("cancel_remove")}
        onConfirm={handleConfirmRemoveEmulator}
        onClose={() => setRemoveOpen(false)}
        buttonsIsDisabled={busy}
      />
    </div>
  );
}
