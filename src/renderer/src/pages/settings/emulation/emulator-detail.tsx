import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { InfoIcon, SyncIcon, TrashIcon } from "@primer/octicons-react";

import { Button, ClassicsScanIndicator } from "@renderer/components";
import { showExecutableOpenDialog } from "@renderer/helpers";
import { useClassicsScan, useToast } from "@renderer/hooks";
import { formatBytes } from "@shared";
import type { EmulatorConfig, RomFolder } from "@types";

import { KNOWN_BINARY_LABELS } from "./known-binary-labels";
import { EMULATOR_ICONS } from "./emulator-icons";
import { BiosSection } from "./bios-section";
import { FirmwareSection } from "./firmware-section";
import {
  DetailHeader,
  DetailRemoveModals,
  DetailTabBar,
  ExecutableRow,
  LibraryStatsGrid,
  notifyRedetectOutcome,
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
      const previous = {
        executablePath: config.executablePath,
        detectedVersion: config.detectedVersion,
      };
      const next = await window.electron.detectEmulator(config.system);
      onChange(next);
      notifyRedetectOutcome(
        next,
        previous,
        binaryName,
        t,
        showErrorToast,
        showSuccessToast
      );
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
    const result = await showExecutableOpenDialog(config.executablePath);
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
      <DetailHeader
        title={systemLabel}
        icon={binaryIcon}
        detectedName={binaryName}
        isConfigured={isConfigured}
        detectedVersion={config.detectedVersion}
        totalFiles={config.totalFiles}
        rescanDisabled={busy || scan.active}
        rescanSpinning={scan.active}
        onBack={onBack}
        onRescan={handleRescan}
      />

      {!supportsFirmware && (
        <p className="emulator-detail__bios-note">
          <InfoIcon size={14} />
          <span>{t("bios_note", { name: binaryName })}</span>
        </p>
      )}

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

      <DetailRemoveModals
        emulatorName={binaryName}
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
