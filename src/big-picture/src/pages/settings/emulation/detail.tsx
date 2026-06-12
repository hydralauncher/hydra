import {
  AlertIcon,
  CheckCircleFillIcon,
  ChevronLeftIcon,
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
import type { EmulatorConfig, RomFolder } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Button,
  FocusItem,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../../components";
import { ConfirmationModal } from "../../../components/modals";
import { useBigPictureToast, useNavigationScreenActions } from "../../../hooks";
import {
  EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
  EMULATION_DETAIL_BACK_BUTTON_ID,
  EMULATION_DETAIL_EXECUTABLE_REGION_ID,
  EMULATION_DETAIL_LIBRARY_REGION_ID,
  EMULATION_DETAIL_MEMORY_CARDS_DETECT_BUTTON_ID,
  EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID,
  EMULATION_DETAIL_EXECUTABLE_BUTTON_ID,
  EMULATION_DETAIL_REDETECT_BUTTON_ID,
  EMULATION_DETAIL_REGION_ID,
  EMULATION_DETAIL_REMOVE_EMULATOR_BUTTON_ID,
  EMULATION_DETAIL_ROM_FOLDERS_REGION_ID,
  EMULATION_DETAIL_RESCAN_BUTTON_ID,
  SETTINGS_HEADER_RETURN_TARGET,
  getEmulationRomFolderRemoveFocusId,
  getEmulationRomFolderToggleFocusId,
} from "../settings-navigation";
import { CloudSavesSection } from "./cloud-saves-section";
import { MemoryCardsSection } from "./memory-cards-section";
import {
  EMULATOR_ICONS,
  KNOWN_BINARY_LABELS,
  SETTINGS_TOAST_OPTIONS,
  formatBytes,
  formatRelative,
} from "./shared";

interface EmulationDetailProps {
  config: EmulatorConfig;
  systemLabel: string;
  onBack: () => void;
  onChange: (nextConfig: EmulatorConfig) => void;
}

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

export function EmulationDetail({
  config,
  systemLabel,
  onBack,
  onChange,
}: Readonly<EmulationDetailProps>) {
  const { t, i18n } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [isBusy, setIsBusy] = useState(false);
  const [cloudRefreshKey, setCloudRefreshKey] = useState(0);
  const [folderToRemove, setFolderToRemove] = useState<RomFolder | null>(null);
  const [removeEmulatorOpen, setRemoveEmulatorOpen] = useState(false);
  const [executableExists, setExecutableExists] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!config.executablePath) {
      setExecutableExists(false);
      return undefined;
    }

    void globalThis.window.electron
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
  }, [config.executablePath, config.system]);

  const binaryName = KNOWN_BINARY_LABELS[config.binary];
  const binaryIcon = EMULATOR_ICONS[config.binary];
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const isConfigured = config.executablePath !== null;
  const storageLabel = useMemo(
    () => formatBytes(config.totalSizeBytes),
    [config.totalSizeBytes]
  );
  const lastScanLabel = useMemo(
    () => formatRelative(config.lastScanAt),
    [config.lastScanAt]
  );
  const hasMemoryCardsSection =
    config.system === "ps1" || config.system === "ps2";
  const firstRomFolderFocusId = config.romFolders[0]
    ? getEmulationRomFolderToggleFocusId(config.romFolders[0].id)
    : null;
  const lastRomFolderFocusId =
    config.romFolders.length > 0
      ? getEmulationRomFolderRemoveFocusId(
          config.romFolders[config.romFolders.length - 1]!.id
        )
      : EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID;
  const romSectionDownTargetId = hasMemoryCardsSection
    ? EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID
    : EMULATION_DETAIL_RESCAN_BUTTON_ID;

  const handleBrowseExecutable = useCallback(async () => {
    const isMac = globalThis.window.electron.platform === "darwin";
    const result = await globalThis.window.electron.showOpenDialog({
      properties: isMac ? ["openFile", "openDirectory"] : ["openFile"],
      defaultPath: config.executablePath ?? undefined,
      filters:
        globalThis.window.electron.platform === "win32"
          ? [{ name: "Executable", extensions: ["exe"] }]
          : isMac
            ? [{ name: "Application", extensions: ["app"] }]
            : undefined,
    });

    if (result.canceled || result.filePaths.length === 0) return;

    setIsBusy(true);

    try {
      const preview =
        await globalThis.window.electron.previewEmulatorExecutable(
          config.system,
          result.filePaths[0]
        );
      if (!preview) {
        showErrorToast("Invalid emulator executable", SETTINGS_TOAST_OPTIONS);
        return;
      }

      const next = await globalThis.window.electron.setEmulatorExecutablePath(
        config.system,
        result.filePaths[0]
      );
      onChange(next);
      showSuccessToast("Executable path updated", SETTINGS_TOAST_OPTIONS);
    } catch {
      showErrorToast(
        "Failed to update executable path",
        SETTINGS_TOAST_OPTIONS
      );
    } finally {
      setIsBusy(false);
    }
  }, [
    config.executablePath,
    config.system,
    onChange,
    showErrorToast,
    showSuccessToast,
  ]);

  const handleRedetect = useCallback(async () => {
    setIsBusy(true);

    try {
      const previousPath = config.executablePath;
      const previousVersion = config.detectedVersion;
      const next = await globalThis.window.electron.detectEmulator(
        config.system
      );
      onChange(next);

      if (next.executablePath === null) {
        showErrorToast("Emulator was not found", SETTINGS_TOAST_OPTIONS);
      } else if (next.executablePath !== previousPath) {
        showSuccessToast("Executable path updated", SETTINGS_TOAST_OPTIONS);
      } else if (
        next.detectedVersion &&
        next.detectedVersion !== previousVersion
      ) {
        showSuccessToast("Version updated", {
          ...SETTINGS_TOAST_OPTIONS,
          message: `v${next.detectedVersion}`,
        });
      } else {
        showSuccessToast("Detection refreshed", SETTINGS_TOAST_OPTIONS);
      }
    } catch {
      showErrorToast("Failed to detect emulator", SETTINGS_TOAST_OPTIONS);
    } finally {
      setIsBusy(false);
    }
  }, [
    config.detectedVersion,
    config.executablePath,
    config.system,
    onChange,
    showErrorToast,
    showSuccessToast,
  ]);

  const handleAddFolder = useCallback(async () => {
    const result = await globalThis.window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });

    if (result.canceled || result.filePaths.length === 0) return;

    setIsBusy(true);

    try {
      const folderPath = result.filePaths[0];
      if (config.romFolders.some((folder) => folder.path === folderPath)) {
        showErrorToast("Folder already added", SETTINGS_TOAST_OPTIONS);
        return;
      }

      const next = await globalThis.window.electron.addRomFolder(
        config.system,
        folderPath,
        true,
        language
      );
      onChange(next);
      showSuccessToast("ROM folder added", SETTINGS_TOAST_OPTIONS);
    } catch {
      showErrorToast("Failed to add ROM folder", SETTINGS_TOAST_OPTIONS);
    } finally {
      setIsBusy(false);
    }
  }, [
    config.romFolders,
    config.system,
    language,
    onChange,
    showErrorToast,
    showSuccessToast,
  ]);

  const handleToggleSubfolders = useCallback(
    async (folder: RomFolder) => {
      setIsBusy(true);

      try {
        const next = await globalThis.window.electron.toggleRomFolderSubfolders(
          config.system,
          folder.id,
          !folder.scanSubfolders
        );
        onChange(next);
      } catch {
        showErrorToast(
          "Failed to update folder scan options",
          SETTINGS_TOAST_OPTIONS
        );
      } finally {
        setIsBusy(false);
      }
    },
    [config.system, onChange, showErrorToast]
  );

  const handleConfirmRemoveFolder = useCallback(async () => {
    if (!folderToRemove) return;

    setIsBusy(true);

    try {
      const next = await globalThis.window.electron.removeRomFolder(
        config.system,
        folderToRemove.id
      );
      onChange(next);
      setFolderToRemove(null);
      showSuccessToast("ROM folder removed", SETTINGS_TOAST_OPTIONS);
    } catch {
      showErrorToast("Failed to remove ROM folder", SETTINGS_TOAST_OPTIONS);
    } finally {
      setIsBusy(false);
    }
  }, [
    config.system,
    folderToRemove,
    onChange,
    showErrorToast,
    showSuccessToast,
  ]);

  const handleRescan = useCallback(async () => {
    setIsBusy(true);

    try {
      const next = await globalThis.window.electron.rescanEmulator(
        config.system,
        language
      );
      onChange(next);
      showSuccessToast("Library rescanned", SETTINGS_TOAST_OPTIONS);
    } catch {
      showErrorToast(
        "Failed to rescan emulator library",
        SETTINGS_TOAST_OPTIONS
      );
    } finally {
      setIsBusy(false);
    }
  }, [config.system, language, onChange, showErrorToast, showSuccessToast]);

  const handleConfirmRemoveEmulator = useCallback(async () => {
    setIsBusy(true);

    try {
      const next = await globalThis.window.electron.removeEmulator(
        config.system
      );
      onChange(next);
      setRemoveEmulatorOpen(false);
      showSuccessToast(
        "Emulator configuration removed",
        SETTINGS_TOAST_OPTIONS
      );
      onBack();
    } catch {
      showErrorToast("Failed to remove emulator", SETTINGS_TOAST_OPTIONS);
    } finally {
      setIsBusy(false);
    }
  }, [config.system, onBack, onChange, showErrorToast, showSuccessToast]);

  useNavigationScreenActions({
    press: {
      b: () => {
        onBack();
      },
    },
  });

  return (
    <VerticalFocusGroup
      regionId={EMULATION_DETAIL_REGION_ID}
      navigationOverrides={{ up: SETTINGS_HEADER_RETURN_TARGET }}
      className="emulator-detail"
    >
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

      <section className="emulator-detail__hero">
        <div className="emulator-detail__hero-text">
          <h2 className="emulator-detail__hero-title">{systemLabel}</h2>
          <div className="emulator-detail__hero-meta">
            {binaryIcon ? (
              <img
                src={binaryIcon}
                alt=""
                className="emulator-detail__hero-icon"
                aria-hidden="true"
              />
            ) : null}
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
            disabled={isBusy || !isConfigured}
            icon={<TrashIcon size={14} />}
            onClick={() => setRemoveEmulatorOpen(true)}
          >
            {t("remove_emulator")}
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
              {config.detectedVersion ? (
                <>
                  <span className="emulator-detail__dot" />
                  <span className="emulator-detail__exec-version">
                    v{config.detectedVersion}
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
                  itemId: EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
                },
              }}
              asChild
            >
              <button
                type="button"
                className="emulator-detail__exec-path-button"
                onClick={() => {
                  void handleBrowseExecutable();
                }}
                disabled={isBusy}
                title={t("change_executable_path")}
                aria-label={t("change_executable_path")}
              >
                <span
                  className={`emulator-detail__exec-path-text${
                    config.executablePath
                      ? ""
                      : " emulator-detail__exec-path-text--placeholder"
                  }`}
                  title={config.executablePath ?? undefined}
                >
                  {config.executablePath ?? t("select_executable_placeholder")}
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
                  itemId: EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
                },
              }}
              variant="secondary"
              disabled={isBusy}
              icon={<SyncIcon size={13} />}
              onClick={() => {
                void handleRedetect();
              }}
            >
              {t("re_detect")}
            </Button>
          </div>
        </HorizontalFocusGroup>
      </section>

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
                    itemId: EMULATION_DETAIL_EXECUTABLE_BUTTON_ID,
                  },
                  down: firstRomFolderFocusId
                    ? {
                        type: "item",
                        itemId: firstRomFolderFocusId,
                      }
                    : {
                        type: "item",
                        itemId: romSectionDownTargetId,
                      },
                }}
                variant="secondary"
                disabled={isBusy}
                icon={<PlusIcon size={14} />}
                onClick={() => {
                  void handleAddFolder();
                }}
              >
                {t("add_folder")}
              </Button>
            </div>
          </header>

          <div className="emulator-detail__folders">
            {config.romFolders.length === 0 ? (
              <p className="emulator-detail__empty">{t("no_rom_folder")}</p>
            ) : null}

            {config.romFolders.map((folder, index) => (
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
                              config.romFolders[index - 1]!.id
                            ),
                          },
                    down:
                      index < config.romFolders.length - 1
                        ? {
                            type: "item",
                            itemId: getEmulationRomFolderToggleFocusId(
                              config.romFolders[index + 1]!.id
                            ),
                          }
                        : {
                            type: "item",
                            itemId: romSectionDownTargetId,
                          },
                  }}
                  asChild
                >
                  <label className="emulator-detail__subfolders-toggle">
                    <input
                      type="checkbox"
                      checked={folder.scanSubfolders}
                      disabled={isBusy}
                      onChange={() => {
                        void handleToggleSubfolders(folder);
                      }}
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
                              config.romFolders[index - 1]!.id
                            ),
                          },
                    down:
                      index < config.romFolders.length - 1
                        ? {
                            type: "item",
                            itemId: getEmulationRomFolderRemoveFocusId(
                              config.romFolders[index + 1]!.id
                            ),
                          }
                        : {
                            type: "item",
                            itemId: romSectionDownTargetId,
                          },
                  }}
                  asChild
                >
                  <button
                    type="button"
                    className="emulator-detail__remove"
                    onClick={() => setFolderToRemove(folder)}
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

      {hasMemoryCardsSection && (
        <MemoryCardsSection
          config={config}
          upTargetId={lastRomFolderFocusId}
          downTargetId={EMULATION_DETAIL_RESCAN_BUTTON_ID}
          onUploaded={() => setCloudRefreshKey((current) => current + 1)}
        />
      )}

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
                    itemId: hasMemoryCardsSection
                      ? EMULATION_DETAIL_MEMORY_CARDS_DETECT_BUTTON_ID
                      : lastRomFolderFocusId,
                  },
                }}
                variant="secondary"
                disabled={isBusy}
                icon={<SyncIcon size={13} />}
                onClick={() => {
                  void handleRescan();
                }}
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
              <span className="emulator-detail__stat-value">
                {storageLabel}
              </span>
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
              <span className="emulator-detail__stat-value">
                {lastScanLabel}
              </span>
              <span className="emulator-detail__stat-caption">
                {t("stat_last_scan_caption")}
              </span>
            </div>
          </div>
        </section>
      </VerticalFocusGroup>

      {hasMemoryCardsSection ? (
        <CloudSavesSection
          config={config}
          refreshKey={cloudRefreshKey}
          upTargetId={EMULATION_DETAIL_RESCAN_BUTTON_ID}
        />
      ) : null}

      <ConfirmationModal
        visible={folderToRemove !== null}
        title={t("remove_rom_folder_title")}
        description={t("remove_rom_folder_description", {
          path: folderToRemove?.path ?? "",
        })}
        confirmLabel={t("remove")}
        danger
        onClose={() => setFolderToRemove(null)}
        onConfirm={handleConfirmRemoveFolder}
      />

      <ConfirmationModal
        visible={removeEmulatorOpen}
        title={t("remove_emulator_title", { name: binaryName })}
        description={t("remove_emulator_description", { name: binaryName })}
        confirmLabel={t("remove")}
        danger
        onClose={() => setRemoveEmulatorOpen(false)}
        onConfirm={handleConfirmRemoveEmulator}
      />
    </VerticalFocusGroup>
  );
}
