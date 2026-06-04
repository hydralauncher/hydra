import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertIcon,
  ChevronLeftIcon,
  CheckCircleFillIcon,
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

const formatRelative = (ts: number | null): string => {
  if (ts === null) return "—";
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

export function EmulatorDetail({
  config,
  systemLabel,
  onBack,
  onChange,
  refresh,
}: Readonly<EmulatorDetailProps>) {
  const { t } = useTranslation("settings");
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
    const result = await window.electron.showOpenDialog({
      properties: ["openFile"],
      defaultPath: config.executablePath ?? undefined,
      filters:
        window.electron.platform === "win32"
          ? [{ name: "Executable", extensions: ["exe"] }]
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
  const lastScanLabel = useMemo(
    () => formatRelative(config.lastScanAt),
    [config.lastScanAt]
  );

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
            <h3>{t("emulator_section_title")}</h3>
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
                          value: formatRelative(folder.lastScanAt),
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
            <span className="emulator-detail__stat-label">
              {t("stat_games")}
            </span>
            <span className="emulator-detail__stat-value">
              {config.totalFiles}
            </span>
            <span className="emulator-detail__stat-caption">
              {t("stat_games_caption", { system: systemLabel })}
            </span>
          </div>
          <div className="emulator-detail__stat">
            <span className="emulator-detail__stat-label">
              {t("stat_storage")}
            </span>
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
            <span className="emulator-detail__stat-label">
              {t("stat_last_scan")}
            </span>
            <span className="emulator-detail__stat-value">{lastScanLabel}</span>
            <span className="emulator-detail__stat-caption">&nbsp;</span>
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
