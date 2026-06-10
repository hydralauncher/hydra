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

import { Button, FocusItem, VerticalFocusGroup } from "../../../components";
import { ConfirmationModal } from "../../../components/modals";
import {
  useBigPictureToast,
  useNavigation,
  useNavigationScreenActions,
} from "../../../hooks";
import {
  EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
  EMULATION_DETAIL_BACK_BUTTON_ID,
  EMULATION_DETAIL_EXECUTABLE_BUTTON_ID,
  EMULATION_DETAIL_REDETECT_BUTTON_ID,
  EMULATION_DETAIL_REGION_ID,
  EMULATION_DETAIL_REMOVE_EMULATOR_BUTTON_ID,
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

function isNodeWithinRegion(
  nodeId: string,
  regionId: string,
  nodes: ReturnType<typeof useNavigation>["nodes"],
  regions: ReturnType<typeof useNavigation>["regions"]
) {
  const node = nodes.find((candidate) => candidate.id === nodeId);

  if (!node) return false;

  let currentRegionId: string | null = node.regionId;

  while (currentRegionId) {
    if (currentRegionId === regionId) {
      return true;
    }

    currentRegionId =
      regions.find((candidate) => candidate.id === currentRegionId)
        ?.parentRegionId ?? null;
  }

  return false;
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
  const { currentFocusId, moveFocus, nodes, regions, setFocus } =
    useNavigation();
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

  const handleBrowseExecutable = useCallback(async () => {
    const result = await globalThis.window.electron.showOpenDialog({
      properties: ["openFile"],
      defaultPath: config.executablePath ?? undefined,
      filters:
        globalThis.window.electron.platform === "win32"
          ? [{ name: "Executable", extensions: ["exe"] }]
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

  const handleContainedDetailDirection = useCallback(
    (direction: "left" | "right") => {
      if (!currentFocusId) return;

      const previousFocusId = currentFocusId;
      const nextFocusId = moveFocus(direction);

      if (
        !isNodeWithinRegion(
          previousFocusId,
          EMULATION_DETAIL_REGION_ID,
          nodes,
          regions
        )
      ) {
        return;
      }

      if (
        nextFocusId &&
        !isNodeWithinRegion(
          nextFocusId,
          EMULATION_DETAIL_REGION_ID,
          nodes,
          regions
        )
      ) {
        setFocus(previousFocusId);
      }
    },
    [currentFocusId, moveFocus, nodes, regions, setFocus]
  );

  useNavigationScreenActions({
    press: {
      b: () => {
        onBack();
      },
    },
    direction: {
      left: () => {
        handleContainedDetailDirection("left");
      },
      right: () => {
        handleContainedDetailDirection("right");
      },
    },
  });

  return (
    <VerticalFocusGroup
      regionId={EMULATION_DETAIL_REGION_ID}
      navigationOverrides={{ up: SETTINGS_HEADER_RETURN_TARGET }}
      className="emulator-detail"
    >
      <FocusItem id={EMULATION_DETAIL_BACK_BUTTON_ID} asChild>
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

            <FocusItem id={EMULATION_DETAIL_EXECUTABLE_BUTTON_ID} asChild>
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
        </div>
      </section>

      <section className="emulator-detail__section">
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("rom_folders_section_title")}</h3>
            <p>{t("rom_folders_section_description")}</p>
          </div>
          <div className="emulator-detail__section-actions">
            <Button
              focusId={EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID}
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

              <FocusItem
                id={getEmulationRomFolderToggleFocusId(folder.id)}
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

      {(config.system === "ps2" || config.system === "ps1") && (
        <MemoryCardsSection
          config={config}
          onUploaded={() => setCloudRefreshKey((current) => current + 1)}
        />
      )}

      <section className="emulator-detail__section">
        <header className="emulator-detail__section-header">
          <div className="emulator-detail__section-text">
            <h3>{t("library_section_title")}</h3>
            <p>{t("library_section_description", { system: systemLabel })}</p>
          </div>
          <div className="emulator-detail__section-actions">
            <Button
              focusId={EMULATION_DETAIL_RESCAN_BUTTON_ID}
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

      {config.system === "ps1" || config.system === "ps2" ? (
        <CloudSavesSection config={config} refreshKey={cloudRefreshKey} />
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
