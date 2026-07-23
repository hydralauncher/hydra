import { useTranslation } from "react-i18next";
import {
  ClockIcon,
  DatabaseIcon,
  FileDirectoryIcon,
  PencilIcon,
  PlusIcon,
  XIcon,
} from "@primer/octicons-react";

import { Button, CheckboxField } from "@renderer/components";
import type { RomFolder } from "@types";

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
          {t(
            totalFiles === 1
              ? "stat_storage_caption_one"
              : totalFiles === 0
                ? "stat_storage_caption_zero"
                : "stat_storage_caption_other",
            {
              count: totalFiles,
              folders: t(
                romFoldersCount === 1
                  ? "folder_count_one"
                  : "folder_count_other",
                { count: romFoldersCount }
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
  );
}
