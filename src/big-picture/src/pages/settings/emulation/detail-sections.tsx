import {
  AlertIcon,
  CheckCircleFillIcon,
  ChevronLeftIcon,
  FileDirectoryIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  SyncIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";
import type { RomFolder } from "@types";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  LibraryStatsGrid,
  RomFolderInfo,
} from "@renderer/pages/settings/emulation/emulation-detail-sections";

import {
  Button,
  FocusItem,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../../components";
import { ConfirmationModal } from "../../../components/modals";
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

interface DetailBackButtonProps {
  onBack: () => void;
}

export function DetailBackButton({ onBack }: Readonly<DetailBackButtonProps>) {
  const { t } = useTranslation("settings");

  return (
    <FocusItem
      id={EMULATION_DETAIL_BACK_BUTTON_ID}
      navigationOverrides={{
        left: { type: "block" },
        right: {
          type: "item",
          itemId: EMULATION_DETAIL_REMOVE_EMULATOR_BUTTON_ID,
        },
        down: {
          type: "item",
          itemId: EMULATION_DETAIL_EXECUTABLE_BUTTON_ID,
        },
      }}
      asChild
    >
      <button
        type="button"
        className="emulator-detail__breadcrumb"
        onClick={onBack}
      >
        <ChevronLeftIcon size={12} />
        <span>{t("back_to_emulation")}</span>
      </button>
    </FocusItem>
  );
}

interface DetailHeroBPProps {
  title: string;
  icon: string | undefined;
  detectedName: string;
  isConfigured: boolean;
  totalFiles: number;
  removeDisabled: boolean;
  onRemove: () => void;
}

export function DetailHeroBP({
  title,
  icon,
  detectedName,
  isConfigured,
  totalFiles,
  removeDisabled,
  onRemove,
}: Readonly<DetailHeroBPProps>) {
  const { t } = useTranslation("settings");

  return (
    <section className="emulator-detail__hero">
      <div className="emulator-detail__hero-text">
        <h2 className="emulator-detail__hero-title">{title}</h2>
        <div className="emulator-detail__hero-meta">
          {icon ? (
            <img
              src={icon}
              alt=""
              className="emulator-detail__hero-icon"
              aria-hidden="true"
            />
          ) : null}
          <span className="emulator-detail__hero-detected">
            {isConfigured
              ? t("detected", { name: detectedName })
              : t("not_detected")}
          </span>
          <span className="emulator-detail__dot" />
          <span className="emulator-detail__hero-count">
            <span className="emulator-detail__hero-count-dot" />
            {t("games_found_other", { count: totalFiles })}
          </span>
        </div>
      </div>

      <div className="emulator-detail__hero-actions">
        <Button
          focusId={EMULATION_DETAIL_REMOVE_EMULATOR_BUTTON_ID}
          focusNavigationOverrides={{
            left: {
              type: "item",
              itemId: EMULATION_DETAIL_BACK_BUTTON_ID,
            },
            right: { type: "block" },
            down: {
              type: "item",
              itemId: EMULATION_DETAIL_REDETECT_BUTTON_ID,
            },
          }}
          variant="danger"
          disabled={removeDisabled}
          icon={<TrashIcon size={14} />}
          onClick={onRemove}
        >
          {t("remove_emulator")}
        </Button>
      </div>
    </section>
  );
}

interface RedetectOutcome {
  executablePath: string | null;
  detectedVersion: string | null;
}

interface RedetectToasts {
  showErrorToast: (title: string, options?: object) => void;
  showSuccessToast: (title: string, options?: object) => void;
  toastOptions: object;
}

export const notifyRedetectOutcomeBP = (
  next: RedetectOutcome,
  previous: RedetectOutcome,
  { showErrorToast, showSuccessToast, toastOptions }: RedetectToasts
): void => {
  if (next.executablePath === null) {
    showErrorToast("Emulator was not found", toastOptions);
  } else if (next.executablePath !== previous.executablePath) {
    showSuccessToast("Executable path updated", toastOptions);
  } else if (
    next.detectedVersion &&
    next.detectedVersion !== previous.detectedVersion
  ) {
    showSuccessToast("Version updated", {
      ...toastOptions,
      message: `v${next.detectedVersion}`,
    });
  } else {
    showSuccessToast("Detection refreshed", toastOptions);
  }
};

interface DetailModalsBPProps {
  emulatorName: string;
  folderToRemove: RomFolder | null;
  removeEmulatorOpen: boolean;
  onConfirmRemoveFolder: () => void;
  onCloseRemoveFolder: () => void;
  onConfirmRemoveEmulator: () => void;
  onCloseRemoveEmulator: () => void;
}

export function DetailModalsBP({
  emulatorName,
  folderToRemove,
  removeEmulatorOpen,
  onConfirmRemoveFolder,
  onCloseRemoveFolder,
  onConfirmRemoveEmulator,
  onCloseRemoveEmulator,
}: Readonly<DetailModalsBPProps>) {
  const { t } = useTranslation("settings");

  return (
    <>
      <ConfirmationModal
        visible={folderToRemove !== null}
        title={t("remove_rom_folder_title")}
        description={t("remove_rom_folder_description", {
          path: folderToRemove?.path ?? "",
        })}
        confirmLabel={t("remove")}
        danger
        onClose={onCloseRemoveFolder}
        onConfirm={onConfirmRemoveFolder}
      />

      <ConfirmationModal
        visible={removeEmulatorOpen}
        title={t("remove_emulator_title", { name: emulatorName })}
        description={t("remove_emulator_description", { name: emulatorName })}
        confirmLabel={t("remove")}
        danger
        onClose={onCloseRemoveEmulator}
        onConfirm={onConfirmRemoveEmulator}
      />
    </>
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

  let statusBadge: ReactNode = null;
  if (isConfigured) {
    statusBadge = executableExists ? (
      <span className="emulator-detail__synced">
        <CheckCircleFillIcon size={14} />
        <span>{t("synced")}</span>
      </span>
    ) : (
      <span className="emulator-detail__path-missing">
        <AlertIcon size={14} />
        <span>{t("executable_missing")}</span>
      </span>
    );
  }

  return (
    <section className="emulator-detail__section">
      <header className="emulator-detail__section-header">
        <div className="emulator-detail__section-text">
          <div className="emulator-detail__section-title-row">
            <h3>{t("emulator_section_title")}</h3>
            {statusBadge}
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

              <RomFolderInfo folder={folder} formatLastScan={formatRelative} />

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

        <LibraryStatsGrid
          systemLabel={systemLabel}
          totalFiles={totalFiles}
          storageLabel={storageLabel}
          lastScanLabel={lastScanLabel}
          romFoldersCount={romFoldersCount}
        />

        {children}
      </section>
    </VerticalFocusGroup>
  );
}
