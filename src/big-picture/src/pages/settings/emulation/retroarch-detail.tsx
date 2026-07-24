import { CheckCircleFillIcon, DownloadIcon } from "@primer/octicons-react";
import type { RetroArchConfig, RomFolder } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  RETROARCH_PLATFORM_LABELS,
  showExecutableOpenDialog,
} from "@renderer/helpers";
import { RETROARCH_EMULATOR_ICON } from "@renderer/pages/settings/emulation/emulator-icons";
import {
  RETROARCH_CORE_LIST,
  RETROARCH_CORES_LINE,
  RETROARCH_LABEL,
} from "@renderer/pages/settings/emulation/retroarch-meta";

import { Button, VerticalFocusGroup } from "../../../components";
import { useBigPictureToast, useNavigationScreenActions } from "../../../hooks";
import {
  EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
  EMULATION_DETAIL_CORES_REGION_ID,
  EMULATION_DETAIL_EXECUTABLE_BUTTON_ID,
  EMULATION_DETAIL_INSTALL_ALL_CORES_BUTTON_ID,
  EMULATION_DETAIL_REGION_ID,
  EMULATION_DETAIL_RESCAN_BUTTON_ID,
  SETTINGS_HEADER_RETURN_TARGET,
  getEmulationRomFolderRemoveFocusId,
} from "../settings-navigation";
import {
  DetailBackButton,
  DetailHeroBP,
  DetailModalsBP,
  ExecSection,
  LibraryStatsSectionBP,
  notifyRedetectOutcomeBP,
  RomFoldersSectionBP,
} from "./detail-sections";
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

  const installedCoreCount = useMemo(
    () =>
      RETROARCH_CORE_LIST.filter(
        (core) => config.cores[core.name]?.installed === true
      ).length,
    [config.cores]
  );
  const allCoresInstalled = installedCoreCount === RETROARCH_CORE_LIST.length;

  const lastRomFolder = config.romFolders.at(-1);
  const lastRomFolderFocusId = lastRomFolder
    ? getEmulationRomFolderRemoveFocusId(lastRomFolder.id)
    : EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID;

  const handleBrowseExecutable = useCallback(async () => {
    const result = await showExecutableOpenDialog(config.executablePath);

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
      const previous = {
        executablePath: config.executablePath,
        detectedVersion: config.detectedVersion,
      };
      const next = await globalThis.window.electron.detectRetroArch();
      onChange(next);
      notifyRedetectOutcomeBP(next, previous, {
        showErrorToast,
        showSuccessToast,
        toastOptions: SETTINGS_TOAST_OPTIONS,
      });
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
      <DetailBackButton onBack={onBack} />

      <DetailHeroBP
        title={RETROARCH_LABEL}
        icon={RETROARCH_EMULATOR_ICON}
        detectedName={RETROARCH_LABEL}
        isConfigured={isConfigured}
        totalFiles={config.totalFiles}
        removeDisabled={isBusy || !isConfigured}
        onRemove={() => setRemoveEmulatorOpen(true)}
      />

      <ExecSection
        icon={RETROARCH_EMULATOR_ICON}
        name={RETROARCH_LABEL}
        detectedVersion={config.detectedVersion}
        executablePath={config.executablePath}
        executableExists={executableExists}
        isBusy={isBusy}
        execDownTargetId={EMULATION_DETAIL_INSTALL_ALL_CORES_BUTTON_ID}
        onBrowse={() => {
          void handleBrowseExecutable();
        }}
        onRedetect={() => {
          void handleRedetect();
        }}
      />

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
                  installed: installedCoreCount,
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
                    itemId: EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
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
            <div className="emulator-detail__row">
              {allCoresInstalled ? (
                <CheckCircleFillIcon size={24} />
              ) : (
                <DownloadIcon size={24} />
              )}

              <div className="emulator-detail__folder-info">
                <span className="emulator-detail__folder-path">
                  {RETROARCH_CORES_LINE}
                </span>
                <div className="emulator-detail__folder-meta">
                  <span>
                    {allCoresInstalled
                      ? t("retroarch_cores_ready")
                      : t("retroarch_cores_installed_count", {
                          installed: installedCoreCount,
                          total: RETROARCH_CORE_LIST.length,
                        })}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </VerticalFocusGroup>

      <RomFoldersSectionBP
        folders={config.romFolders}
        isBusy={isBusy}
        addUpTargetId={EMULATION_DETAIL_INSTALL_ALL_CORES_BUTTON_ID}
        rowsDownTargetId={EMULATION_DETAIL_RESCAN_BUTTON_ID}
        onAddFolder={() => {
          void handleAddFolder();
        }}
        onToggleSubfolders={(folder) => {
          void handleToggleSubfolders(folder);
        }}
        onRemoveRequest={setFolderToRemove}
      />

      <LibraryStatsSectionBP
        systemLabel={RETROARCH_LABEL}
        totalFiles={config.totalFiles}
        storageLabel={storageLabel}
        lastScanLabel={lastScanLabel}
        romFoldersCount={config.romFolders.length}
        rescanUpTargetId={lastRomFolderFocusId}
        isBusy={isBusy}
        onRescan={() => {
          void handleRescan();
        }}
      >
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
      </LibraryStatsSectionBP>

      <DetailModalsBP
        emulatorName={RETROARCH_LABEL}
        folderToRemove={folderToRemove}
        removeEmulatorOpen={removeEmulatorOpen}
        onConfirmRemoveFolder={handleConfirmRemoveFolder}
        onCloseRemoveFolder={() => setFolderToRemove(null)}
        onConfirmRemoveEmulator={handleConfirmRemoveEmulator}
        onCloseRemoveEmulator={() => setRemoveEmulatorOpen(false)}
      />
    </VerticalFocusGroup>
  );
}
