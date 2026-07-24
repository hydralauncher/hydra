import { useTranslation } from "react-i18next";
import cn from "classnames";
import {
  ChevronLeftIcon,
  ClockIcon,
  DatabaseIcon,
  FileDirectoryIcon,
  PencilIcon,
  PlusIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";

import { Button, CheckboxField, ConfirmationModal } from "@renderer/components";
import type { RomFolder } from "@types";

import { EmulatorResourceRow } from "./emulator-resource-row";

export function GamepadIcon({ size = 16 }: Readonly<{ size?: number }>) {
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

interface RomFolderInfoProps {
  folder: RomFolder;
  formatLastScan: (ts: number | null) => string;
}

export function RomFolderInfo({
  folder,
  formatLastScan,
}: Readonly<RomFolderInfoProps>) {
  const { t } = useTranslation("settings");

  return (
    <div className="emulator-detail__folder-info">
      <span className="emulator-detail__folder-path">{folder.path}</span>
      <div className="emulator-detail__folder-meta">
        <span>
          {t(folder.fileCount === 1 ? "file_count_one" : "file_count_other", {
            count: folder.fileCount,
          })}
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
  );
}

interface RomFoldersSectionProps {
  folders: RomFolder[];
  disabled: boolean;
  formatLastScan: (ts: number | null) => string;
  onAddFolder: () => void;
  onToggleSubfolders: (folder: RomFolder) => void;
  onRemoveFolder: (folder: RomFolder) => void;
  onChangeFolder?: (folder: RomFolder) => void;
}

export function RomFoldersSection({
  folders,
  disabled,
  formatLastScan,
  onAddFolder,
  onToggleSubfolders,
  onRemoveFolder,
  onChangeFolder,
}: Readonly<RomFoldersSectionProps>) {
  const { t } = useTranslation("settings");

  return (
    <section className="emulator-detail__section">
      <header className="emulator-detail__section-header">
        <div className="emulator-detail__section-text">
          <h3>{t("rom_folders_section_title")}</h3>
          <p>{t("rom_folders_section_description")}</p>
        </div>
        <Button theme="outline" onClick={onAddFolder} disabled={disabled}>
          <PlusIcon size={14} />
          <span>{t("add_folder")}</span>
        </Button>
      </header>

      <div className="emulator-detail__folders">
        {folders.length === 0 && (
          <p className="emulator-detail__empty">{t("no_rom_folder")}</p>
        )}
        {folders.map((folder) => (
          <div className="emulator-detail__row" key={folder.id}>
            <FileDirectoryIcon size={24} />
            <RomFolderInfo folder={folder} formatLastScan={formatLastScan} />
            <CheckboxField
              label={t("scan_subfolders")}
              checked={folder.scanSubfolders}
              disabled={disabled}
              onChange={() => onToggleSubfolders(folder)}
            />
            {onChangeFolder && (
              <button
                type="button"
                className="emulator-detail__remove"
                onClick={() => onChangeFolder(folder)}
                aria-label={t("setup_rom_change")}
                title={t("setup_rom_change")}
                disabled={disabled}
              >
                <PencilIcon size={16} />
              </button>
            )}
            <button
              type="button"
              className="emulator-detail__remove"
              onClick={() => onRemoveFolder(folder)}
              aria-label={t("remove")}
              disabled={disabled}
            >
              <XIcon size={16} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

interface LibraryStatsGridProps {
  systemLabel: string;
  totalFiles: number;
  storageLabel: string;
  lastScanLabel: string;
  romFoldersCount: number;
}

export function LibraryStatsGrid({
  systemLabel,
  totalFiles,
  storageLabel,
  lastScanLabel,
  romFoldersCount,
}: Readonly<LibraryStatsGridProps>) {
  const { t } = useTranslation("settings");

  let storageCaptionKey = "stat_storage_caption_other";
  if (totalFiles === 0) {
    storageCaptionKey = "stat_storage_caption_zero";
  } else if (totalFiles === 1) {
    storageCaptionKey = "stat_storage_caption_one";
  }

  return (
    <div className="emulator-detail__stats">
      <div className="emulator-detail__stat">
        <div className="emulator-detail__stat-head">
          <GamepadIcon size={16} />
          <span className="emulator-detail__stat-label">{t("stat_games")}</span>
        </div>
        <span className="emulator-detail__stat-value">{totalFiles}</span>
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
          {t(storageCaptionKey, {
            count: totalFiles,
            folders: t(
              romFoldersCount === 1 ? "folder_count_one" : "folder_count_other",
              { count: romFoldersCount }
            ),
          })}
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
  );
}

interface DetailHeaderProps {
  title: string;
  icon: string | undefined;
  detectedName: string;
  isConfigured: boolean;
  detectedVersion: string | null;
  totalFiles: number;
  rescanDisabled: boolean;
  rescanSpinning: boolean;
  onBack: () => void;
  onRescan: () => void;
}

export function DetailHeader({
  title,
  icon,
  detectedName,
  isConfigured,
  detectedVersion,
  totalFiles,
  rescanDisabled,
  rescanSpinning,
  onBack,
  onRescan,
}: Readonly<DetailHeaderProps>) {
  const { t } = useTranslation("settings");

  return (
    <>
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
          <h2 className="emulator-detail__hero-title">{title}</h2>
          <div className="emulator-detail__hero-meta">
            {icon && (
              <img
                src={icon}
                alt=""
                className="emulator-detail__hero-icon"
                aria-hidden="true"
              />
            )}
            <span className="emulator-detail__hero-detected">
              {isConfigured
                ? t("detected", { name: detectedName })
                : t("not_detected")}
            </span>
            {detectedVersion && (
              <span className="emulator-detail__hero-version">
                v{detectedVersion}
              </span>
            )}
            <span className="emulator-detail__dot" />
            <span className="emulator-detail__hero-count">
              <span className="emulator-detail__hero-count-dot" />
              {t("games_found_other", { count: totalFiles })}
            </span>
          </div>
        </div>
        <div className="emulator-detail__hero-actions">
          <Button theme="primary" onClick={onRescan} disabled={rescanDisabled}>
            <SyncIcon
              size={16}
              className={
                rescanSpinning
                  ? "emulator-detail__redetect-icon--spinning"
                  : undefined
              }
            />
            <span>{t("rescan_library")}</span>
          </Button>
        </div>
      </section>
    </>
  );
}

interface DetailTabBarProps<T extends string> {
  tabs: { id: T; label: string }[];
  activeTab: T;
  onChange: (tab: T) => void;
}

export function DetailTabBar<T extends string>({
  tabs,
  activeTab,
  onChange,
}: Readonly<DetailTabBarProps<T>>) {
  return (
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
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

interface ExecutableRowProps {
  executablePath: string | null;
  executableExists: boolean;
  busy: boolean;
  onRedetect: () => void;
  onBrowse: () => void;
}

export function ExecutableRow({
  executablePath,
  executableExists,
  busy,
  onRedetect,
  onBrowse,
}: Readonly<ExecutableRowProps>) {
  const { t } = useTranslation("settings");
  const isConfigured = executablePath !== null;

  let statusLabel = t("not_detected");
  if (isConfigured) {
    statusLabel = executableExists ? t("synced") : t("executable_missing");
  }

  return (
    <EmulatorResourceRow
      title={t("executable_path_title")}
      description={t("executable_path_description")}
      detected={isConfigured && executableExists}
      statusLabel={statusLabel}
      path={{
        text: executablePath,
        placeholder: t("select_executable_placeholder"),
        onClick: onBrowse,
        disabled: busy,
        title: t("change_executable_path"),
      }}
      actions={
        <>
          <Button theme="outline" onClick={onRedetect} disabled={busy}>
            <SyncIcon
              size={13}
              className={
                busy ? "emulator-detail__redetect-icon--spinning" : undefined
              }
            />
            <span>{t("re_detect")}</span>
          </Button>
          <Button theme="primary" onClick={onBrowse} disabled={busy}>
            <FileDirectoryIcon size={16} />
            <span>{t("browse")}</span>
          </Button>
        </>
      }
    />
  );
}

interface RedetectOutcome {
  executablePath: string | null;
  detectedVersion: string | null;
}

export const notifyRedetectOutcome = (
  next: RedetectOutcome,
  previous: RedetectOutcome,
  name: string,
  t: (key: string, options?: Record<string, unknown>) => string,
  showErrorToast: (message: string) => void,
  showSuccessToast: (message: string) => void
): void => {
  if (next.executablePath === null) {
    showErrorToast(t("redetect_not_found", { name }));
  } else if (next.executablePath !== previous.executablePath) {
    showSuccessToast(t("redetect_path_updated"));
  } else if (
    next.detectedVersion &&
    next.detectedVersion !== previous.detectedVersion
  ) {
    showSuccessToast(
      t("redetect_version_updated", { version: next.detectedVersion })
    );
  } else {
    showSuccessToast(t("redetect_unchanged"));
  }
};

interface DetailRemoveModalsProps {
  emulatorName: string;
  folderToRemove: RomFolder | null;
  removeEmulatorOpen: boolean;
  busy: boolean;
  onConfirmRemoveFolder: () => void;
  onCloseRemoveFolder: () => void;
  onConfirmRemoveEmulator: () => void;
  onCloseRemoveEmulator: () => void;
}

export function DetailRemoveModals({
  emulatorName,
  folderToRemove,
  removeEmulatorOpen,
  busy,
  onConfirmRemoveFolder,
  onCloseRemoveFolder,
  onConfirmRemoveEmulator,
  onCloseRemoveEmulator,
}: Readonly<DetailRemoveModalsProps>) {
  const { t } = useTranslation("settings");

  return (
    <>
      <ConfirmationModal
        visible={folderToRemove !== null}
        title={t("remove_rom_folder_title")}
        descriptionText={t("remove_rom_folder_description", {
          path: folderToRemove?.path ?? "",
        })}
        confirmButtonLabel={t("remove")}
        cancelButtonLabel={t("cancel_remove")}
        onConfirm={onConfirmRemoveFolder}
        onClose={onCloseRemoveFolder}
        buttonsIsDisabled={busy}
      />

      <ConfirmationModal
        visible={removeEmulatorOpen}
        title={t("remove_emulator_title", { name: emulatorName })}
        descriptionText={t("remove_emulator_description", {
          name: emulatorName,
        })}
        confirmButtonLabel={t("remove")}
        cancelButtonLabel={t("cancel_remove")}
        onConfirm={onConfirmRemoveEmulator}
        onClose={onCloseRemoveEmulator}
        buttonsIsDisabled={busy}
      />
    </>
  );
}
