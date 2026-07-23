import {
  AlertIcon,
  CheckCircleFillIcon,
  ClockIcon,
  DatabaseIcon,
  FileDirectoryIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  SyncIcon,
  XIcon,
} from "@primer/octicons-react";
import type { RomFolder } from "@types";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  FocusItem,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../../components";
import {
  EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
  EMULATION_DETAIL_BACK_BUTTON_ID,
  EMULATION_DETAIL_EXECUTABLE_REGION_ID,
  EMULATION_DETAIL_EXECUTABLE_BUTTON_ID,
  EMULATION_DETAIL_LIBRARY_REGION_ID,
  EMULATION_DETAIL_REDETECT_BUTTON_ID,
  EMULATION_DETAIL_REMOVE_EMULATOR_BUTTON_ID,
  EMULATION_DETAIL_RESCAN_BUTTON_ID,
  EMULATION_DETAIL_ROM_FOLDERS_REGION_ID,
  getEmulationRomFolderRemoveFocusId,
  getEmulationRomFolderToggleFocusId,
} from "../settings-navigation";
import { formatRelative } from "./shared";

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

interface ExecSectionProps {
  icon: string | null;
  name: string;
  detectedVersion: string | null;
  executablePath: string | null;
  executableExists: boolean;
  isBusy: boolean;
  execDownTargetId: string;
  onBrowse: () => void;
  onRedetect: () => void;
}

export function ExecSection({
  icon,
  name,
  detectedVersion,
  executablePath,
  executableExists,
  isBusy,
  execDownTargetId,
  onBrowse,
  onRedetect,
}: Readonly<ExecSectionProps>) {
  const { t } = useTranslation("settings");
  const isConfigured = executablePath !== null;

  return (
    <section className="emulator-detail__section">
      <header className="emulator-detail__section-header">
        <div className="emulator-detail__section-text">
          <div className="emulator-detail__section-title-row">
            <h3>{t("emulator_section_title")}</h3>
            {isConfigured ? (
              executableExists ? (
                <span className="emulator-detail__synced">
                  <CheckCircleFillIcon size={14} />
                  <span>{t("synced")}</span>
                </span>
              ) : (
                <span className="emulator-detail__path-missing">
                  <AlertIcon size={14} />
                  <span>{t("executable_missing")}</span>
                </span>
              )
            ) : null}
          </div>
          <p>{t("emulator_section_description")}</p>
        </div>
      </header>

      <HorizontalFocusGroup
        regionId={EMULATION_DETAIL_EXECUTABLE_REGION_ID}
        className="emulator-detail__row emulator-detail__exec-row"
      >
        {icon ? (
          <img
            src={icon}
            alt=""
            className="emulator-detail__exec-icon"
            aria-hidden="true"
          />
        ) : (
          <PackageIcon size={24} />
        )}

        <div className="emulator-detail__exec-info">
          <div className="emulator-detail__exec-header">
            <span className="emulator-detail__exec-name">{name}</span>
            {detectedVersion ? (
              <>
                <span className="emulator-detail__dot" />
                <span className="emulator-detail__exec-version">
                  v{detectedVersion}
                </span>
              </>
            ) : null}
          </div>

          <span className="emulator-detail__exec-label">
            {t("executable_path")}
          </span>

          <FocusItem
            id={EMULATION_DETAIL_EXECUTABLE_BUTTON_ID}
            navigationOverrides={{
              left: { type: "block" },
              right: {
                type: "item",
                itemId: EMULATION_DETAIL_REDETECT_BUTTON_ID,
              },
              up: {
                type: "item",
                itemId: EMULATION_DETAIL_BACK_BUTTON_ID,
              },
              down: {
                type: "item",
                itemId: execDownTargetId,
              },
            }}
            asChild
          >
            <button
              type="button"
              className="emulator-detail__exec-path-button"
              onClick={onBrowse}
              disabled={isBusy}
              title={t("change_executable_path")}
              aria-label={t("change_executable_path")}
            >
              <span
                className={`emulator-detail__exec-path-text${
                  executablePath
                    ? ""
                    : " emulator-detail__exec-path-text--placeholder"
                }`}
                title={executablePath ?? undefined}
              >
                {executablePath ?? t("select_executable_placeholder")}
              </span>
              <PencilIcon
                size={12}
                className="emulator-detail__exec-path-pencil"
              />
            </button>
          </FocusItem>
        </div>

        <div className="emulator-detail__exec-actions">
          <Button
            focusId={EMULATION_DETAIL_REDETECT_BUTTON_ID}
            focusNavigationOverrides={{
              left: {
                type: "item",
                itemId: EMULATION_DETAIL_EXECUTABLE_BUTTON_ID,
              },
              right: { type: "block" },
              up: {
                type: "item",
                itemId: EMULATION_DETAIL_REMOVE_EMULATOR_BUTTON_ID,
              },
              down: {
                type: "item",
                itemId: execDownTargetId,
              },
            }}
            variant="secondary"
            disabled={isBusy}
            icon={<SyncIcon size={13} />}
            onClick={onRedetect}
          >
            {t("re_detect")}
          </Button>
        </div>
      </HorizontalFocusGroup>
    </section>
  );
}

interface RomFoldersSectionBPProps {
  folders: RomFolder[];
  isBusy: boolean;
  addUpTargetId: string;
  rowsDownTargetId: string;
  onAddFolder: () => void;
  onToggleSubfolders: (folder: RomFolder) => void;
  onRemoveRequest: (folder: RomFolder) => void;
}

export function RomFoldersSectionBP({
  folders,
  isBusy,
  addUpTargetId,
  rowsDownTargetId,
  onAddFolder,
  onToggleSubfolders,
  onRemoveRequest,
}: Readonly<RomFoldersSectionBPProps>) {
  const { t } = useTranslation("settings");

  const firstRomFolderFocusId = folders[0]
    ? getEmulationRomFolderToggleFocusId(folders[0].id)
    : null;

  return (
    <VerticalFocusGroup
      regionId={EMULATION_DETAIL_ROM_FOLDERS_REGION_ID}
      className="emulator-detail__section"
      asChild
    >
      <section>
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("rom_folders_section_title")}</h3>
            <p>{t("rom_folders_section_description")}</p>
          </div>
          <div className="emulator-detail__section-actions">
            <Button
              focusId={EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID}
              focusNavigationOverrides={{
                left: { type: "block" },
                right: { type: "block" },
                up: {
                  type: "item",
                  itemId: addUpTargetId,
                },
                down: firstRomFolderFocusId
                  ? {
                      type: "item",
                      itemId: firstRomFolderFocusId,
                    }
                  : {
                      type: "item",
                      itemId: rowsDownTargetId,
                    },
              }}
              variant="secondary"
              disabled={isBusy}
              icon={<PlusIcon size={14} />}
              onClick={onAddFolder}
            >
              {t("add_folder")}
            </Button>
          </div>
        </header>

        <div className="emulator-detail__folders">
          {folders.length === 0 ? (
            <p className="emulator-detail__empty">{t("no_rom_folder")}</p>
          ) : null}

          {folders.map((folder, index) => (
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

              <FocusItem
                id={getEmulationRomFolderToggleFocusId(folder.id)}
                navigationOverrides={{
                  left: { type: "block" },
                  right: {
                    type: "item",
                    itemId: getEmulationRomFolderRemoveFocusId(folder.id),
                  },
                  up:
                    index === 0
                      ? {
                          type: "item",
                          itemId: EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
                        }
                      : {
                          type: "item",
                          itemId: getEmulationRomFolderToggleFocusId(
                            folders[index - 1]!.id
                          ),
                        },
                  down:
                    index < folders.length - 1
                      ? {
                          type: "item",
                          itemId: getEmulationRomFolderToggleFocusId(
                            folders[index + 1]!.id
                          ),
                        }
                      : {
                          type: "item",
                          itemId: rowsDownTargetId,
                        },
                }}
                asChild
              >
                <label className="emulator-detail__subfolders-toggle">
                  <input
                    type="checkbox"
                    checked={folder.scanSubfolders}
                    disabled={isBusy}
                    onChange={() => onToggleSubfolders(folder)}
                  />
                  <span>{t("scan_subfolders")}</span>
                </label>
              </FocusItem>

              <FocusItem
                id={getEmulationRomFolderRemoveFocusId(folder.id)}
                navigationOverrides={{
                  left: {
                    type: "item",
                    itemId: getEmulationRomFolderToggleFocusId(folder.id),
                  },
                  right: { type: "block" },
                  up:
                    index === 0
                      ? {
                          type: "item",
                          itemId: EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
                        }
                      : {
                          type: "item",
                          itemId: getEmulationRomFolderRemoveFocusId(
                            folders[index - 1]!.id
                          ),
                        },
                  down:
                    index < folders.length - 1
                      ? {
                          type: "item",
                          itemId: getEmulationRomFolderRemoveFocusId(
                            folders[index + 1]!.id
                          ),
                        }
                      : {
                          type: "item",
                          itemId: rowsDownTargetId,
                        },
                }}
                asChild
              >
                <button
                  type="button"
                  className="emulator-detail__remove"
                  onClick={() => onRemoveRequest(folder)}
                  aria-label={t("remove")}
                  disabled={isBusy}
                >
                  <XIcon size={16} />
                </button>
              </FocusItem>
            </div>
          ))}
        </div>
      </section>
    </VerticalFocusGroup>
  );
}

interface LibraryStatsSectionBPProps {
  systemLabel: string;
  totalFiles: number;
  storageLabel: string;
  lastScanLabel: string;
  romFoldersCount: number;
  rescanUpTargetId: string;
  isBusy: boolean;
  onRescan: () => void;
  children?: ReactNode;
}

export function LibraryStatsSectionBP({
  systemLabel,
  totalFiles,
  storageLabel,
  lastScanLabel,
  romFoldersCount,
  rescanUpTargetId,
  isBusy,
  onRescan,
  children,
}: Readonly<LibraryStatsSectionBPProps>) {
  const { t } = useTranslation("settings");

  return (
    <VerticalFocusGroup
      regionId={EMULATION_DETAIL_LIBRARY_REGION_ID}
      className="emulator-detail__section"
      asChild
    >
      <section>
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("library_section_title")}</h3>
            <p>{t("library_section_description", { system: systemLabel })}</p>
          </div>
          <div className="emulator-detail__section-actions">
            <Button
              focusId={EMULATION_DETAIL_RESCAN_BUTTON_ID}
              focusNavigationOverrides={{
                left: { type: "block" },
                right: { type: "block" },
                up: {
                  type: "item",
                  itemId: rescanUpTargetId,
                },
              }}
              variant="secondary"
              disabled={isBusy}
              icon={<SyncIcon size={13} />}
              onClick={onRescan}
            >
              {t("rescan")}
            </Button>
          </div>
        </header>

        <div className="emulator-detail__stats">
          <div className="emulator-detail__stat">
            <div className="emulator-detail__stat-head">
              <GamepadIcon size={16} />
              <span className="emulator-detail__stat-label">
                {t("stat_games")}
              </span>
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

        {children}
      </section>
    </VerticalFocusGroup>
  );
}
