import { ChevronLeftIcon, InfoIcon, TrashIcon } from "@primer/octicons-react";
import type { EmulatorConfig, RomFolder } from "@types";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, FocusItem, VerticalFocusGroup } from "../../../components";
import { ConfirmationModal } from "../../../components/modals";
import { useBigPictureToast, useNavigationScreenActions } from "../../../hooks";
import {
  EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID,
  EMULATION_DETAIL_BACK_BUTTON_ID,
  EMULATION_DETAIL_MEMORY_CARDS_DETECT_BUTTON_ID,
  EMULATION_DETAIL_MEMORY_CARDS_PICK_BUTTON_ID,
  EMULATION_DETAIL_EXECUTABLE_BUTTON_ID,
  EMULATION_DETAIL_REDETECT_BUTTON_ID,
  EMULATION_DETAIL_REGION_ID,
  EMULATION_DETAIL_REMOVE_EMULATOR_BUTTON_ID,
  EMULATION_DETAIL_RESCAN_BUTTON_ID,
  SETTINGS_HEADER_RETURN_TARGET,
  getEmulationRomFolderRemoveFocusId,
} from "../settings-navigation";
import { CloudSavesSection } from "./cloud-saves-section";
import {
  ExecSection,
  LibraryStatsSectionBP,
  RomFoldersSectionBP,
} from "./detail-sections";
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

      <ExecSection
        icon={binaryIcon ?? null}
        name={binaryName}
        detectedVersion={config.detectedVersion}
        executablePath={config.executablePath}
        executableExists={executableExists}
        isBusy={isBusy}
        execDownTargetId={EMULATION_DETAIL_ADD_FOLDER_BUTTON_ID}
        onBrowse={() => {
          void handleBrowseExecutable();
        }}
        onRedetect={() => {
          void handleRedetect();
        }}
      />

      <RomFoldersSectionBP
        folders={config.romFolders}
        isBusy={isBusy}
        addUpTargetId={EMULATION_DETAIL_EXECUTABLE_BUTTON_ID}
        rowsDownTargetId={romSectionDownTargetId}
        onAddFolder={() => {
          void handleAddFolder();
        }}
        onToggleSubfolders={(folder) => {
          void handleToggleSubfolders(folder);
        }}
        onRemoveRequest={setFolderToRemove}
      />

      {hasMemoryCardsSection && (
        <MemoryCardsSection
          config={config}
          upTargetId={lastRomFolderFocusId}
          downTargetId={EMULATION_DETAIL_RESCAN_BUTTON_ID}
          onUploaded={() => setCloudRefreshKey((current) => current + 1)}
        />
      )}

      <LibraryStatsSectionBP
        systemLabel={systemLabel}
        totalFiles={config.totalFiles}
        storageLabel={storageLabel}
        lastScanLabel={lastScanLabel}
        romFoldersCount={config.romFolders.length}
        rescanUpTargetId={
          hasMemoryCardsSection
            ? EMULATION_DETAIL_MEMORY_CARDS_DETECT_BUTTON_ID
            : lastRomFolderFocusId
        }
        isBusy={isBusy}
        onRescan={() => {
          void handleRescan();
        }}
      />

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
