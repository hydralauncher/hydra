import {
  AlertIcon,
  CheckCircleFillIcon,
  ChevronLeftIcon,
  ClockIcon,
  DatabaseIcon,
  DownloadIcon,
  FileDirectoryIcon,
  PackageIcon,
  PencilIcon,
  PlusIcon,
  SyncIcon,
  TrashIcon,
  XIcon,
} from "@primer/octicons-react";
import type { RetroArchConfig, RetroArchCoreName, RomFolder } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { RETROARCH_PLATFORM_LABELS } from "@renderer/helpers";
import { RETROARCH_EMULATOR_ICON } from "@renderer/pages/settings/emulation/emulator-icons";
import {
  RETROARCH_CORE_LIST,
  RETROARCH_LABEL,
} from "@renderer/pages/settings/emulation/retroarch-meta";

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
  EMULATION_DETAIL_CORES_REGION_ID,
  EMULATION_DETAIL_EXECUTABLE_REGION_ID,
  EMULATION_DETAIL_EXECUTABLE_BUTTON_ID,
  EMULATION_DETAIL_INSTALL_ALL_CORES_BUTTON_ID,
  EMULATION_DETAIL_LIBRARY_REGION_ID,
  EMULATION_DETAIL_REDETECT_BUTTON_ID,
  EMULATION_DETAIL_REGION_ID,
  EMULATION_DETAIL_REMOVE_EMULATOR_BUTTON_ID,
  EMULATION_DETAIL_RESCAN_BUTTON_ID,
  EMULATION_DETAIL_ROM_FOLDERS_REGION_ID,
  SETTINGS_HEADER_RETURN_TARGET,
  getEmulationCoreInstallFocusId,
  getEmulationRomFolderRemoveFocusId,
  getEmulationRomFolderToggleFocusId,
} from "../settings-navigation";
import { SETTINGS_TOAST_OPTIONS, formatBytes, formatRelative } from "./shared";

interface RetroArchEmulationDetailProps {
  config: RetroArchConfig;
  onBack: () => void;
  onChange: (nextConfig: RetroArchConfig) => void;
}

export function RetroArchEmulationDetail({
  config,
  onBack,
  onChange,
}: Readonly<RetroArchEmulationDetailProps>) {
  const { t, i18n } = useTranslation("settings");
  const { showSuccessToast, showErrorToast } = useBigPictureToast();
  const [isBusy, setIsBusy] = useState(false);
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
      .checkRetroArchExecutable()
      .then(({ exists }) => {
        if (!cancelled) setExecutableExists(exists);
      })
      .catch(() => {
        if (!cancelled) setExecutableExists(false);
      });

    return () => {
      cancelled = true;
    };
  }, [config.executablePath]);

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

  const firstCoreFocusId = getEmulationCoreInstallFocusId(
    RETROARCH_CORE_LIST[0].name
  );
  const lastCoreFocusId = getEmulationCoreInstallFocusId(
    RETROARCH_CORE_LIST[RETROARCH_CORE_LIST.length - 1].name
  );
  const firstRomFolderFocusId = config.romFolders[0]
    ? getEmulationRomFolderToggleFocusId(config.romFolders[0].id)
    : null;
  const lastRomFolderFocusId =
    config.romFolders.length > 0
      ? getEmulationRomFolderRemoveFocusId(
          config.romFolders[config.romFolders.length - 1]!.id
        )
      : EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID;

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
      const next = await globalThis.window.electron.setRetroArchExecutablePath(
        result.filePaths[0]
      );
      if (!next) {
        showErrorToast("Invalid emulator executable", SETTINGS_TOAST_OPTIONS);
        return;
      }

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
  }, [config.executablePath, onChange, showErrorToast, showSuccessToast]);

  const handleRedetect = useCallback(async () => {
    setIsBusy(true);

    try {
      const previousPath = config.executablePath;
      const previousVersion = config.detectedVersion;
      const next = await globalThis.window.electron.detectRetroArch();
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
    onChange,
    showErrorToast,
    showSuccessToast,
  ]);

  const handleInstallCore = useCallback(
    async (core: RetroArchCoreName) => {
      setIsBusy(true);

      try {
        const result =
          await globalThis.window.electron.installRetroArchCore(core);
        const next = await globalThis.window.electron.getRetroArchConfig();
        onChange(next);
        if (result.ok) {
          showSuccessToast("Core installed", SETTINGS_TOAST_OPTIONS);
        } else {
          showErrorToast("Failed to install core", SETTINGS_TOAST_OPTIONS);
        }
      } catch {
        showErrorToast("Failed to install core", SETTINGS_TOAST_OPTIONS);
      } finally {
        setIsBusy(false);
      }
    },
    [onChange, showErrorToast, showSuccessToast]
  );

  const handleInstallAllCores = useCallback(async () => {
    setIsBusy(true);

    try {
      const results =
        await globalThis.window.electron.installAllRetroArchCores();
      const next = await globalThis.window.electron.getRetroArchConfig();
      onChange(next);
      const failed = results.filter((result) => !result.ok).length;
      if (failed === 0) {
        showSuccessToast("All cores installed", SETTINGS_TOAST_OPTIONS);
      } else {
        showErrorToast(
          `Failed to install ${failed} core(s)`,
          SETTINGS_TOAST_OPTIONS
        );
      }
    } catch {
      showErrorToast("Failed to install cores", SETTINGS_TOAST_OPTIONS);
    } finally {
      setIsBusy(false);
    }
  }, [onChange, showErrorToast, showSuccessToast]);

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

      await globalThis.window.electron.addRetroArchRomFolder(folderPath, true);
      const next = await globalThis.window.electron.rescanRetroArch(language);
      onChange(next);
      showSuccessToast("ROM folder added", SETTINGS_TOAST_OPTIONS);
    } catch {
      showErrorToast("Failed to add ROM folder", SETTINGS_TOAST_OPTIONS);
    } finally {
      setIsBusy(false);
    }
  }, [config.romFolders, language, onChange, showErrorToast, showSuccessToast]);

  const handleToggleSubfolders = useCallback(
    async (folder: RomFolder) => {
      setIsBusy(true);

      try {
        const next = await globalThis.window.electron.toggleRetroArchSubfolders(
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
    [onChange, showErrorToast]
  );

  const handleConfirmRemoveFolder = useCallback(async () => {
    if (!folderToRemove) return;

    setIsBusy(true);

    try {
      const next = await globalThis.window.electron.removeRetroArchRomFolder(
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
  }, [folderToRemove, onChange, showErrorToast, showSuccessToast]);

  const handleRescan = useCallback(async () => {
    setIsBusy(true);

    try {
      const next = await globalThis.window.electron.rescanRetroArch(language);
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
  }, [language, onChange, showErrorToast, showSuccessToast]);

  const handleConfirmRemoveEmulator = useCallback(async () => {
    setIsBusy(true);

    try {
      const next = await globalThis.window.electron.removeRetroArch();
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
  }, [onBack, onChange, showErrorToast, showSuccessToast]);

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
          <h2 className="emulator-detail__hero-title">
            {t("retroarch_card_title")}
          </h2>
          <div className="emulator-detail__hero-meta">
            <img
              src={RETROARCH_EMULATOR_ICON}
              alt=""
              className="emulator-detail__hero-icon"
              aria-hidden="true"
            />
            <span className="emulator-detail__hero-detected">
              {isConfigured
                ? t("detected", { name: RETROARCH_LABEL })
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
          {RETROARCH_EMULATOR_ICON ? (
            <img
              src={RETROARCH_EMULATOR_ICON}
              alt=""
              className="emulator-detail__exec-icon"
              aria-hidden="true"
            />
          ) : (
            <PackageIcon size={24} />
          )}

          <div className="emulator-detail__exec-info">
            <div className="emulator-detail__exec-header">
              <span className="emulator-detail__exec-name">
                {RETROARCH_LABEL}
              </span>
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
                  itemId: EMULATION_DETAIL_INSTALL_ALL_CORES_BUTTON_ID,
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
                  itemId: EMULATION_DETAIL_INSTALL_ALL_CORES_BUTTON_ID,
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
        regionId={EMULATION_DETAIL_CORES_REGION_ID}
        className="emulator-detail__section"
        asChild
      >
        <section>
          <header className="emulator-detail__section-header">
            <div className="emulator-detail__section-text">
              <h3>{t("retroarch_cores_section_title")}</h3>
              <p>
                {t("retroarch_cores_section_description", {
                  installed: RETROARCH_CORE_LIST.filter(
                    (core) => config.cores[core.name]?.installed
                  ).length,
                  total: RETROARCH_CORE_LIST.length,
                })}
              </p>
            </div>
            <div className="emulator-detail__section-actions">
              <Button
                focusId={EMULATION_DETAIL_INSTALL_ALL_CORES_BUTTON_ID}
                focusNavigationOverrides={{
                  left: { type: "block" },
                  right: { type: "block" },
                  up: {
                    type: "item",
                    itemId: EMULATION_DETAIL_EXECUTABLE_BUTTON_ID,
                  },
                  down: {
                    type: "item",
                    itemId: firstCoreFocusId,
                  },
                }}
                variant="secondary"
                disabled={isBusy}
                icon={<DownloadIcon size={14} />}
                onClick={() => {
                  void handleInstallAllCores();
                }}
              >
                {t("retroarch_download_all_cores")}
              </Button>
            </div>
          </header>

          <div className="emulator-detail__folders">
            {RETROARCH_CORE_LIST.map((core, index) => {
              const installed = config.cores[core.name]?.installed === true;
              return (
                <div className="emulator-detail__row" key={core.name}>
                  {installed ? (
                    <CheckCircleFillIcon size={24} />
                  ) : (
                    <DownloadIcon size={24} />
                  )}

                  <div className="emulator-detail__folder-info">
                    <span className="emulator-detail__folder-path">
                      {core.label}
                      {" · "}
                      {core.platforms}
                    </span>
                    <div className="emulator-detail__folder-meta">
                      <span>
                        {installed
                          ? t("retroarch_core_installed")
                          : t("retroarch_core_not_installed")}
                      </span>
                    </div>
                  </div>

                  <FocusItem
                    id={getEmulationCoreInstallFocusId(core.name)}
                    navigationOverrides={{
                      left: { type: "block" },
                      right: { type: "block" },
                      up:
                        index === 0
                          ? {
                              type: "item",
                              itemId:
                                EMULATION_DETAIL_INSTALL_ALL_CORES_BUTTON_ID,
                            }
                          : {
                              type: "item",
                              itemId: getEmulationCoreInstallFocusId(
                                RETROARCH_CORE_LIST[index - 1].name
                              ),
                            },
                      down:
                        index < RETROARCH_CORE_LIST.length - 1
                          ? {
                              type: "item",
                              itemId: getEmulationCoreInstallFocusId(
                                RETROARCH_CORE_LIST[index + 1].name
                              ),
                            }
                          : {
                              type: "item",
                              itemId: EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
                            },
                    }}
                    asChild
                  >
                    <button
                      type="button"
                      className="emulator-detail__remove"
                      onClick={() => {
                        void handleInstallCore(core.name);
                      }}
                      aria-label={
                        installed
                          ? t("retroarch_core_update")
                          : t("retroarch_core_download")
                      }
                      disabled={isBusy}
                    >
                      <DownloadIcon size={16} />
                    </button>
                  </FocusItem>
                </div>
              );
            })}
          </div>
        </section>
      </VerticalFocusGroup>

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
                    itemId: lastCoreFocusId,
                  },
                  down: firstRomFolderFocusId
                    ? {
                        type: "item",
                        itemId: firstRomFolderFocusId,
                      }
                    : {
                        type: "item",
                        itemId: EMULATION_DETAIL_RESCAN_BUTTON_ID,
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
                            itemId: EMULATION_DETAIL_RESCAN_BUTTON_ID,
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
                            itemId: EMULATION_DETAIL_RESCAN_BUTTON_ID,
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

      <VerticalFocusGroup
        regionId={EMULATION_DETAIL_LIBRARY_REGION_ID}
        className="emulator-detail__section"
        asChild
      >
        <section>
          <header className="emulator-detail__section-header">
            <div className="emulator-detail__section-text">
              <h3>{t("library_section_title")}</h3>
              <p>
                {t("library_section_description", { system: RETROARCH_LABEL })}
              </p>
            </div>
            <div className="emulator-detail__section-actions">
              <Button
                focusId={EMULATION_DETAIL_RESCAN_BUTTON_ID}
                focusNavigationOverrides={{
                  left: { type: "block" },
                  right: { type: "block" },
                  up: {
                    type: "item",
                    itemId: lastRomFolderFocusId,
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
                <DatabaseIcon size={16} />
                <span className="emulator-detail__stat-label">
                  {t("stat_games")}
                </span>
              </div>
              <span className="emulator-detail__stat-value">
                {config.totalFiles}
              </span>
              <span className="emulator-detail__stat-caption">
                {t("stat_games_caption", { system: RETROARCH_LABEL })}
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

          <div className="emulator-detail__folder-meta">
            {Object.entries(RETROARCH_PLATFORM_LABELS).map(
              ([platform, label], index) => (
                <span key={platform}>
                  {index > 0 && <span className="emulator-detail__dot" />}
                  {label}{" "}
                  {config.perPlatformCounts[
                    platform as keyof typeof config.perPlatformCounts
                  ] ?? 0}
                </span>
              )
            )}
          </div>
        </section>
      </VerticalFocusGroup>

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
        title={t("remove_emulator_title", { name: RETROARCH_LABEL })}
        description={t("remove_emulator_description", {
          name: RETROARCH_LABEL,
        })}
        confirmLabel={t("remove")}
        danger
        onClose={() => setRemoveEmulatorOpen(false)}
        onConfirm={handleConfirmRemoveEmulator}
      />
    </VerticalFocusGroup>
  );
}
