import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertIcon,
  ChevronLeftIcon,
  CheckCircleFillIcon,
  FileDirectoryIcon,
  InfoIcon,
  PackageIcon,
  PlusIcon,
  SyncIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";

import { Button, CheckboxField, ConfirmationModal } from "@renderer/components";
import type { EmulatorConfig, RomFolder } from "@types";

import { KNOWN_BINARY_LABELS } from "./known-binary-labels";
import { EMULATOR_ICONS } from "./emulator-icons";

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
  const { t, i18n } = useTranslation("settings");

  const [busy, setBusy] = useState(false);
  const [folderToRemove, setFolderToRemove] = useState<RomFolder | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [executableExists, setExecutableExists] = useState<boolean>(true);

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
      const next = await window.electron.detectEmulator(config.system);
      onChange(next);
    } finally {
      setBusy(false);
    }
  }, [config.system, onChange]);

  const handleBrowseExecutable = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters:
        window.electron.platform === "win32"
          ? [{ name: "Executable", extensions: ["exe"] }]
          : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return;

    setBusy(true);
    try {
      const next = await window.electron.setEmulatorExecutablePath(
        config.system,
        result.filePaths[0]
      );
      onChange(next);
    } finally {
      setBusy(false);
    }
  }, [config.system, onChange]);

  const handleAddFolder = useCallback(async () => {
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;

    setBusy(true);
    try {
      const language = i18n.language.split("-")[0] || "en";
      const next = await window.electron.addRomFolder(
        config.system,
        result.filePaths[0],
        true,
        language
      );
      onChange(next);
    } finally {
      setBusy(false);
    }
  }, [config.system, i18n.language, onChange]);

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

  const handleRescan = useCallback(async () => {
    setBusy(true);
    try {
      const language = i18n.language.split("-")[0] || "en";
      const next = await window.electron.rescanEmulator(
        config.system,
        language
      );
      onChange(next);
    } finally {
      setBusy(false);
    }
    void refresh;
  }, [config.system, i18n.language, onChange, refresh]);

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

      {/* Section 1: Emulator */}
      <section className="emulator-detail__section">
        <header className="emulator-detail__section-header">
          <span className="emulator-detail__step">1</span>
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
            <span className="emulator-detail__exec-path">
              {config.executablePath ?? "—"}
            </span>
          </div>
          <div className="emulator-detail__exec-actions">
            <Button theme="outline" onClick={handleRedetect} disabled={busy}>
              {t("re_detect")}
            </Button>
            <Button
              theme="primary"
              onClick={handleBrowseExecutable}
              disabled={busy}
            >
              <FileDirectoryIcon size={14} />
              <span>{t("browse_files")}</span>
            </Button>
          </div>
        </div>
      </section>

      {/* Section 2: ROM folders */}
      <section className="emulator-detail__section">
        <header className="emulator-detail__section-header">
          <span className="emulator-detail__step">2</span>
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

      {/* Section 3: Library */}
      <section className="emulator-detail__section">
        <header className="emulator-detail__section-header">
          <span className="emulator-detail__step">3</span>
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
