import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertIcon,
  ChevronLeftIcon,
  CheckCircleFillIcon,
  ClockIcon,
  DatabaseIcon,
  FileDirectoryIcon,
  InfoIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  SyncIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";

import { Button, CheckboxField, ConfirmationModal } from "@renderer/components";
import { useToast } from "@renderer/hooks";
import type { EmulatorConfig, RomFolder } from "@types";

import { KNOWN_BINARY_LABELS } from "./known-binary-labels";
import { EMULATOR_ICONS } from "./emulator-icons";
import { EmulatorScanModal, type ScanFolderInput } from "./emulator-scan-modal";
import { MemoryCardsSection } from "./memory-cards-section";
import { CloudSavesSection } from "./cloud-saves-section";
import { formatRelativeShort } from "./relative-time";

import "./emulator-detail.scss";

interface EmulatorDetailProps {
  config: EmulatorConfig;
  systemLabel: string;
  onBack: () => void;
  onChange: (config: EmulatorConfig) => void;
  refresh: () => Promise<EmulatorConfig | unknown>;
}

const formatBytes = (bytes: number): string => {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};

function GamepadIcon({ size = 16 }: Readonly<{ size?: number }>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="6" x2="10" y1="11" y2="11" />
      <line x1="8" x2="8" y1="9" y2="13" />
      <line x1="15" x2="15.01" y1="12" y2="12" />
      <line x1="18" x2="18.01" y1="10" y2="10" />
      <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z" />
    </svg>
  );
}

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

  const [busy, setBusy] = useState(false);
  const [cloudNonce, setCloudNonce] = useState(0);
  const [folderToRemove, setFolderToRemove] = useState<RomFolder | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [executableExists, setExecutableExists] = useState<boolean>(true);
  const [scanFolders, setScanFolders] = useState<ScanFolderInput[] | null>(
    null
  );

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

    setScanFolders([{ path: folderPath, scanSubfolders: true }]);
  }, [config.romFolders, showErrorToast, t]);

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
    setScanFolders(
      config.romFolders.map((f) => ({
        path: f.path,
        scanSubfolders: f.scanSubfolders,
      }))
    );
  }, [config.romFolders, showErrorToast, t]);

  const handleScanComplete = useCallback(
    async (stats: {
      fileCount: number;
      sizeBytes: number;
      matched: number;
      unmatched: number;
    }) => {
      setScanFolders(null);
      await refresh();
      showSuccessToast(
        t("scan_complete_toast", {
          matched: stats.matched,
          unmatched: stats.unmatched,
        })
      );
    },
    [refresh, showSuccessToast, t]
  );

  const handleScanCancel = useCallback(async () => {
    setScanFolders(null);
    await refresh();
  }, [refresh]);

  const storageLabel = useMemo(
    () => formatBytes(config.totalSizeBytes),
    [config.totalSizeBytes]
  );
  const lastScanLabel = formatLastScan(config.lastScanAt);

  const isConfigured = config.executablePath !== null;

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
            <span className="emulator-detail__dot" />
            <span className="emulator-detail__hero-count">
              <span className="emulator-detail__hero-count-dot" />
              {t("games_found_other", { count: config.totalFiles })}
            </span>
          </div>
        </div>
        <div className="emulator-detail__hero-actions">
          <Button
            theme="danger"
            onClick={() => setRemoveOpen(true)}
            disabled={busy || !isConfigured}
          >
            <TrashIcon size={14} />
            <span>{t("remove_emulator")}</span>
          </Button>
        </div>
      </section>

      <p className="emulator-detail__bios-note">
        <InfoIcon size={14} />
        <span>{t("bios_note", { name: binaryName })}</span>
      </p>

      <section className="emulator-detail__section">
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <div className="emulator-detail__section-title-row">
              <h3>{t("emulator_section_title")}</h3>
              {isConfigured &&
                (executableExists ? (
                  <span className="emulator-detail__synced">
                    <CheckCircleFillIcon size={14} />
                    <span>{t("synced")}</span>
                  </span>
                ) : (
                  <span className="emulator-detail__path-missing">
                    <AlertIcon size={14} />
                    <span>{t("executable_missing")}</span>
                  </span>
                ))}
            </div>
            <p>{t("emulator_section_description")}</p>
          </div>
        </header>

        <div className="emulator-detail__row emulator-detail__exec-row">
          {binaryIcon ? (
            <img
              src={binaryIcon}
              alt=""
              className="emulator-detail__exec-icon"
              aria-hidden="true"
            />
          ) : (
            <PackageIcon size={24} />
          )}
          <div className="emulator-detail__exec-info">
            <div className="emulator-detail__exec-header">
              <span className="emulator-detail__exec-name">{binaryName}</span>
              {config.detectedVersion && (
                <>
                  <span className="emulator-detail__dot" />
                  <span className="emulator-detail__exec-version">
                    v{config.detectedVersion}
                  </span>
                </>
              )}
            </div>
            <span className="emulator-detail__exec-label">
              {t("executable_path")}
            </span>
            <button
              type="button"
              className="emulator-detail__exec-path-button"
              onClick={handleBrowseExecutable}
              disabled={busy}
              title={t("change_executable_path")}
              aria-label={t("change_executable_path")}
            >
              <span
                className={`emulator-detail__exec-path-text${config.executablePath ? "" : " emulator-detail__exec-path-text--placeholder"}`}
                title={config.executablePath ?? undefined}
              >
                {config.executablePath ?? t("select_executable_placeholder")}
              </span>
              <PencilIcon
                size={12}
                className="emulator-detail__exec-path-pencil"
              />
            </button>
          </div>
          <div className="emulator-detail__exec-actions">
            <Button theme="outline" onClick={handleRedetect} disabled={busy}>
              <SyncIcon
                size={13}
                className={
                  busy ? "emulator-detail__redetect-icon--spinning" : undefined
                }
              />
              <span>{t("re_detect")}</span>
            </Button>
          </div>
        </div>
      </section>

      <section className="emulator-detail__section">
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("rom_folders_section_title")}</h3>
            <p>{t("rom_folders_section_description")}</p>
          </div>
          <Button theme="outline" onClick={handleAddFolder} disabled={busy}>
            <PlusIcon size={14} />
            <span>{t("add_folder")}</span>
          </Button>
        </header>

        <div className="emulator-detail__folders">
          {config.romFolders.length === 0 && (
            <p className="emulator-detail__empty">{t("no_rom_folder")}</p>
          )}
          {config.romFolders.map((folder) => (
            <div className="emulator-detail__row" key={folder.id}>
              <FileDirectoryIcon size={24} />
              <div className="emulator-detail__folder-info">
                <span className="emulator-detail__folder-path">
                  {folder.path}
                </span>
                <div className="emulator-detail__folder-meta">
                  <span>
                    {t(
                      folder.fileCount === 1
                        ? "file_count_one"
                        : "file_count_other",
                      { count: folder.fileCount }
                    )}
                  </span>
                  <span className="emulator-detail__dot" />
                  <span>
                    {folder.lastScanAt
                      ? t("last_scan_relative", {
                          value: formatLastScan(folder.lastScanAt),
                        })
                      : t("last_scan_never")}
                  </span>
                </div>
              </div>
              <CheckboxField
                label={t("scan_subfolders")}
                checked={folder.scanSubfolders}
                disabled={busy}
                onChange={() => handleToggleSubfolders(folder)}
              />
              <button
                type="button"
                className="emulator-detail__remove"
                onClick={() => setFolderToRemove(folder)}
                aria-label={t("remove")}
                disabled={busy}
              >
                <XIcon size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {(config.system === "ps2" || config.system === "ps1") && (
        <MemoryCardsSection
          config={config}
          onUploaded={() => setCloudNonce((n) => n + 1)}
        />
      )}

      <section className="emulator-detail__section">
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("library_section_title")}</h3>
            <p>{t("library_section_description", { system: systemLabel })}</p>
          </div>
          <Button theme="outline" onClick={handleRescan} disabled={busy}>
            <SyncIcon size={13} />
            <span>{t("rescan")}</span>
          </Button>
        </header>

        <div className="emulator-detail__stats">
          <div className="emulator-detail__stat">
            <div className="emulator-detail__stat-head">
              <GamepadIcon size={16} />
              <span className="emulator-detail__stat-label">
                {t("stat_games")}
              </span>
            </div>
            <span className="emulator-detail__stat-value">
              {config.totalFiles}
            </span>
            <span className="emulator-detail__stat-caption">
              {t("stat_games_caption", { system: systemLabel })}
            </span>
          </div>
          <div className="emulator-detail__stat">
            <div className="emulator-detail__stat-head">
              <DatabaseIcon size={16} />
              <span className="emulator-detail__stat-label">
                {t("stat_storage")}
              </span>
            </div>
            <span className="emulator-detail__stat-value">{storageLabel}</span>
            <span className="emulator-detail__stat-caption">
              {t(
                config.totalFiles === 1
                  ? "stat_storage_caption_one"
                  : config.totalFiles === 0
                    ? "stat_storage_caption_zero"
                    : "stat_storage_caption_other",
                {
                  count: config.totalFiles,
                  folders: t(
                    config.romFolders.length === 1
                      ? "folder_count_one"
                      : "folder_count_other",
                    { count: config.romFolders.length }
                  ),
                }
              )}
            </span>
          </div>
          <div className="emulator-detail__stat">
            <div className="emulator-detail__stat-head">
              <ClockIcon size={16} />
              <span className="emulator-detail__stat-label">
                {t("stat_last_scan")}
              </span>
            </div>
            <span className="emulator-detail__stat-value">{lastScanLabel}</span>
            <span className="emulator-detail__stat-caption">
              {t("stat_last_scan_caption")}
            </span>
          </div>
        </div>
      </section>

      {(config.system === "ps2" || config.system === "ps1") && (
        <CloudSavesSection config={config} refreshKey={cloudNonce} />
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

      <EmulatorScanModal
        visible={scanFolders !== null}
        system={config.system}
        systemLabel={systemLabel}
        folders={scanFolders ?? []}
        onComplete={handleScanComplete}
        onCancel={handleScanCancel}
      />
    </div>
  );
}
