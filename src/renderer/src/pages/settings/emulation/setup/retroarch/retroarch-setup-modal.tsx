import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal } from "@renderer/components";
import { useRetroArchScan, useToast } from "@renderer/hooks";
import type { RetroArchConfig } from "@types";

import { SetupFooter } from "../setup-footer";
import { SetupStepDone } from "../setup-step-done";
import { SetupStepRomFolder } from "../setup-step-rom-folder";
import { SetupStepScanning } from "../setup-step-scanning";
import { usePendingRomFolders } from "../use-pending-rom-folders";
import { SetupStepCores } from "./setup-step-cores";
import { SetupStepFindEmulator } from "../setup-step-find-emulator";
import { SetupStepRetroArchDownload } from "./setup-step-retroarch-download";
import { RETROARCH_LABEL } from "../../retroarch-meta";

import "../setup-shell.scss";

type RetroArchStepKind =
  | "find_emulator"
  | "cores"
  | "rom_folder"
  | "scanning"
  | "done";

const STEPS: RetroArchStepKind[] = [
  "find_emulator",
  "cores",
  "rom_folder",
  "scanning",
  "done",
];

interface Props {
  visible: boolean;
  initialConfig: RetroArchConfig | null;
  onClose: () => void;
  onComplete: () => void;
}

export function RetroArchSetupModal({
  visible,
  initialConfig,
  onClose,
  onComplete,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");
  const { showErrorToast } = useToast();
  const { scan, start, cancel, reset } = useRetroArchScan();

  const [config, setConfig] = useState<RetroArchConfig | null>(initialConfig);
  const [stepIndex, setStepIndex] = useState(0);
  const [gamesAdded, setGamesAdded] = useState(0);
  const [scanComplete, setScanComplete] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [showDownloadHelp, setShowDownloadHelp] = useState(false);

  const autoDetectRef = useRef(false);
  const scanStartedRef = useRef(false);

  const previewFolder = useCallback(
    async (folderPath: string, scanSubfolders: boolean) => {
      const { fileCount } = await window.electron.previewRetroArchRomFolder(
        folderPath,
        scanSubfolders
      );
      return fileCount;
    },
    []
  );

  const {
    folders,
    setFolders,
    handleAddFolder,
    handleChangeFolder,
    handleRemoveFolder,
    handleToggleSubfolders,
  } = usePendingRomFolders({ previewFolder });

  useEffect(() => {
    if (visible) {
      setConfig(initialConfig);
      setStepIndex(0);
      setFolders([]);
      setGamesAdded(0);
      setScanComplete(false);
      setShowDownloadHelp(false);
      autoDetectRef.current = false;
      scanStartedRef.current = false;
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialConfig]);

  useEffect(() => {
    if (!visible) return;
    if (autoDetectRef.current) return;
    if (initialConfig?.executablePath) return;
    autoDetectRef.current = true;

    let cancelled = false;
    setDetecting(true);
    (async () => {
      try {
        const preview = await window.electron.previewRetroArchExecutable();
        if (cancelled || !preview) return;
        setConfig((curr) => {
          if (curr?.executablePath) return curr;
          if (!curr) return curr;
          return {
            ...curr,
            executablePath: preview.executablePath,
            detectedVersion: preview.detectedVersion,
          };
        });
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, initialConfig?.executablePath]);

  const currentStep = STEPS[stepIndex];

  const goNext = useCallback(() => setStepIndex((i) => i + 1), []);
  const goBack = useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);

  const refreshConfig = useCallback(async () => {
    const next = await window.electron.getRetroArchConfig();
    setConfig(next);
    return next;
  }, []);

  const handleContinue = useCallback(async () => {
    if (
      currentStep === "find_emulator" &&
      config?.executablePath &&
      config.executablePath !== initialConfig?.executablePath
    ) {
      const next = await window.electron.setRetroArchExecutablePath(
        config.executablePath
      );
      if (!next) {
        showErrorToast(t("emulator_invalid_executable"));
        return;
      }
      setConfig(next);
    }
    goNext();
  }, [
    currentStep,
    config,
    initialConfig?.executablePath,
    goNext,
    showErrorToast,
    t,
  ]);

  const handleDownloadReady = useCallback(async () => {
    setShowDownloadHelp(false);
    setDetecting(true);
    try {
      const refreshed = await refreshConfig();
      if (refreshed?.executablePath) return;
      const preview = await window.electron.previewRetroArchExecutable();
      if (!preview) return;
      setConfig((curr) =>
        curr
          ? {
              ...curr,
              executablePath: preview.executablePath,
              detectedVersion: preview.detectedVersion,
            }
          : curr
      );
    } finally {
      setDetecting(false);
    }
  }, [refreshConfig]);

  const handleBrowseExecutable = useCallback(async () => {
    const isMac = window.electron.platform === "darwin";
    const result = await window.electron.showOpenDialog({
      properties: isMac ? ["openFile", "openDirectory"] : ["openFile"],
      filters:
        window.electron.platform === "win32"
          ? [{ name: "Executable", extensions: ["exe"] }]
          : isMac
            ? [{ name: "Application", extensions: ["app"] }]
            : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const preview = await window.electron.previewRetroArchExecutable(
      result.filePaths[0]
    );
    if (!preview) {
      showErrorToast(t("emulator_invalid_executable"));
      return;
    }
    setConfig((curr) =>
      curr
        ? {
            ...curr,
            executablePath: preview.executablePath,
            detectedVersion: preview.detectedVersion,
          }
        : curr
    );
  }, [showErrorToast, t]);

  useEffect(() => {
    if (!visible) return;
    if (currentStep !== "scanning") return;
    if (scanStartedRef.current) return;
    scanStartedRef.current = true;
    void start(
      folders.map((f) => ({
        path: f.path,
        scanSubfolders: f.scanSubfolders,
      }))
    );
  }, [visible, currentStep, folders, start]);

  useEffect(() => {
    if (currentStep !== "scanning") return;
    if (!scanStartedRef.current) return;
    if (scan.phase !== "done" || !scan.result) return;
    setGamesAdded(scan.result.matched);
    setScanComplete(true);
    void refreshConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.phase, scan.result, currentStep]);

  useEffect(() => {
    if (!visible) return;
    if (currentStep !== "scanning") return;
    if (!scanStartedRef.current) return;
    if (!scan.error) return;
    showErrorToast(scan.error);
    scanStartedRef.current = false;
    setStepIndex(STEPS.indexOf("rom_folder"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentStep, scan.error]);

  const allCoresInstalled = useMemo(() => {
    if (!config) return false;
    return Object.values(config.cores).every((core) => core.installed);
  }, [config]);

  const continueDisabled = useMemo(() => {
    if (currentStep === "find_emulator") return config?.executablePath === null;
    if (currentStep === "cores") return !allCoresInstalled;
    if (currentStep === "rom_folder") return folders.length === 0;
    if (currentStep === "scanning") return !scanComplete;
    return true;
  }, [currentStep, config, allCoresInstalled, folders, scanComplete]);

  const continueHidden = currentStep === "done";

  if (!visible) return null;

  const handleClose = () => {
    onClose();
  };

  const handleSkip = () => {
    if (currentStep === "cores") {
      goNext();
    } else if (currentStep === "rom_folder") {
      refreshConfig();
      onComplete();
    }
  };

  const handleScanCancel = () => {
    refreshConfig();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={
        <div className="setup-modal__header">
          <h2 className="setup-modal__header-title">
            {t("setup_modal_title", { system: RETROARCH_LABEL })}
          </h2>
        </div>
      }
      onClose={handleClose}
      clickOutsideToClose={false}
    >
      <div className="setup-modal">
        <div className="setup-modal__body">
          {currentStep === "find_emulator" && config && !showDownloadHelp && (
            <SetupStepFindEmulator
              name={RETROARCH_LABEL}
              executablePath={config.executablePath}
              detectedVersion={config.detectedVersion}
              detecting={detecting}
              onBrowse={handleBrowseExecutable}
              onShowDownloadHelp={() => setShowDownloadHelp(true)}
            />
          )}
          {currentStep === "find_emulator" && config && showDownloadHelp && (
            <SetupStepRetroArchDownload />
          )}
          {currentStep === "cores" && config && (
            <SetupStepCores config={config} onConfigChange={setConfig} />
          )}
          {currentStep === "rom_folder" && (
            <SetupStepRomFolder
              systemLabel={RETROARCH_LABEL}
              folders={folders}
              onAddFolder={handleAddFolder}
              onChangeFolder={handleChangeFolder}
              onRemoveFolder={handleRemoveFolder}
              onToggleSubfolders={handleToggleSubfolders}
            />
          )}
          {currentStep === "scanning" && (
            <SetupStepScanning
              systemLabel={RETROARCH_LABEL}
              phase={scan.phase}
              processed={scan.processed}
              total={scan.total}
              percent={scan.percent}
              currentFile={scan.currentFile}
              status={scan.status}
              discovered={scan.discovered}
              matched={scan.matched}
              sizeBytes={scan.sizeBytes}
              unmatchedFiles={scan.result?.unmatchedFiles ?? []}
            />
          )}
          {currentStep === "done" && (
            <SetupStepDone
              systemLabel={RETROARCH_LABEL}
              gamesAdded={gamesAdded}
              onBrowse={onComplete}
            />
          )}
        </div>

        {showDownloadHelp ? (
          <div className="setup-modal__footer">
            <div className="setup-modal__footer-side">
              <button
                type="button"
                className="setup-modal__ghost-button"
                onClick={() => setShowDownloadHelp(false)}
              >
                {t("setup_back")}
              </button>
            </div>
            <div className="setup-modal__dots" />
            <div className="setup-modal__footer-side setup-modal__footer-side--end">
              <Button theme="primary" onClick={handleDownloadReady}>
                {t("setup_download_ready")}
              </Button>
            </div>
          </div>
        ) : (
          <SetupFooter
            currentStepIndex={stepIndex}
            totalSteps={STEPS.length}
            showBack={
              stepIndex > 0 &&
              currentStep !== "scanning" &&
              currentStep !== "done"
            }
            showCancel={currentStep === "find_emulator"}
            showSkip={currentStep === "cores" || currentStep === "rom_folder"}
            continueDisabled={continueDisabled}
            continueHidden={continueHidden}
            endAction={
              currentStep === "scanning" && !scanComplete
                ? {
                    label: t("setup_cancel_scan"),
                    onClick: () => {
                      cancel();
                      handleScanCancel();
                    },
                  }
                : null
            }
            onBack={goBack}
            onCancel={handleClose}
            onSkip={handleSkip}
            onContinue={handleContinue}
          />
        )}
      </div>
    </Modal>
  );
}
