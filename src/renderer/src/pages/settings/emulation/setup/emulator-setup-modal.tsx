import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "@renderer/components";
import type { EmulatorConfig, EmulatorSystem } from "@types";

import { SetupFooter } from "./setup-footer";
import { SetupStepFindEmulator } from "./setup-step-find-emulator";
import { SetupStepFirmware } from "./setup-step-firmware";
import { SetupStepRomFolder } from "./setup-step-rom-folder";
import { SetupStepScanning } from "./setup-step-scanning";
import { SetupStepDone } from "./setup-step-done";
import { type PendingFolder, stepListForSystem, type StepKind } from "./types";

const stepLabelKey: Record<StepKind, string> = {
  find_emulator: "setup_step_label_find_emulator",
  firmware: "setup_step_label_firmware",
  rom_folder: "setup_step_label_rom_folder",
  scanning: "setup_step_label_scanning",
  done: "setup_step_label_done",
};

import "./setup-shell.scss";

interface Props {
  visible: boolean;
  system: EmulatorSystem | null;
  systemLabel: string;
  initialConfig: EmulatorConfig | null;
  onClose: () => void;
  onComplete: (system: EmulatorSystem) => void;
}

export function EmulatorSetupModal({
  visible,
  system,
  systemLabel,
  initialConfig,
  onClose,
  onComplete,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");

  const [config, setConfig] = useState<EmulatorConfig | null>(initialConfig);
  const [stepIndex, setStepIndex] = useState(0);
  const [folders, setFolders] = useState<PendingFolder[]>([]);
  const [firmwareOk, setFirmwareOk] = useState(false);
  const [gamesAdded, setGamesAdded] = useState(0);

  useEffect(() => {
    if (visible) {
      setConfig(initialConfig);
      setStepIndex(0);
      setFolders([]);
      setFirmwareOk(false);
      setGamesAdded(0);
    }
  }, [visible, initialConfig]);

  const prefilledRef = useRef(false);

  const steps = useMemo<StepKind[]>(
    () => (system ? stepListForSystem(system) : []),
    [system]
  );
  const currentStep = steps[stepIndex];

  const goNext = useCallback(() => setStepIndex((i) => i + 1), []);
  const goBack = useCallback(() => setStepIndex((i) => Math.max(0, i - 1)), []);

  const refreshConfig = useCallback(async () => {
    if (!system) return null;
    const all = await window.electron.getEmulatorConfigs();
    setConfig(all[system]);
    return all[system];
  }, [system]);

  const handleBrowseExecutable = useCallback(async () => {
    if (!system) return;
    const result = await window.electron.showOpenDialog({
      properties: ["openFile"],
      filters:
        window.electron.platform === "win32"
          ? [{ name: "Executable", extensions: ["exe"] }]
          : undefined,
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const next = await window.electron.setEmulatorExecutablePath(
      system,
      result.filePaths[0]
    );
    setConfig(next);
  }, [system]);

  const previewFolder = useCallback(
    async (folderPath: string, scanSubfolders: boolean) => {
      if (!system) return null;
      const { requestId } = await window.electron.startRomScan(
        system,
        folderPath,
        scanSubfolders
      );
      return new Promise<number>((resolve) => {
        const unsub = window.electron.onRomScanProgress(
          requestId,
          (payload) => {
            if (payload.type === "done" || payload.type === "cancelled") {
              unsub();
              resolve(payload.fileCount);
            } else if (payload.type === "error") {
              unsub();
              resolve(0);
            }
          }
        );
      });
    },
    [system]
  );

  useEffect(() => {
    if (!visible) {
      prefilledRef.current = false;
      return;
    }
    if (!system) return;
    if (steps[stepIndex] !== "rom_folder") return;
    if (prefilledRef.current) return;
    if (folders.length > 0) return;
    if (system !== "ps1" && system !== "ps2") return;

    prefilledRef.current = true;

    (async () => {
      const paths = await window.electron.getEmulatorRomPaths(system);
      if (paths.length === 0) return;
      const initial: PendingFolder[] = paths.map((p) => ({
        path: p,
        scanSubfolders: true,
        previewCount: null,
      }));
      setFolders(initial);
      for (const f of initial) {
        const count = await previewFolder(f.path, true);
        setFolders((prev) =>
          prev.map((x) =>
            x.path === f.path ? { ...x, previewCount: count } : x
          )
        );
      }
    })();
  }, [visible, system, steps, stepIndex, folders.length, previewFolder]);

  const handleAddFolder = useCallback(async () => {
    if (!system) return;
    const result = await window.electron.showOpenDialog({
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    const folderPath = result.filePaths[0];

    if (folders.some((f) => f.path === folderPath)) return;

    setFolders((prev) => [
      ...prev,
      { path: folderPath, scanSubfolders: true, previewCount: null },
    ]);

    if (system === "ps1" || system === "ps2") {
      window.electron.addEmulatorRomPath(system, folderPath).catch(() => {});
    }

    const count = await previewFolder(folderPath, true);
    setFolders((prev) =>
      prev.map((f) =>
        f.path === folderPath ? { ...f, previewCount: count } : f
      )
    );
  }, [folders, previewFolder, system]);

  const handleChangeFolder = useCallback(
    async (index: number) => {
      const result = await window.electron.showOpenDialog({
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return;
      const newPath = result.filePaths[0];

      const folder = folders[index];
      setFolders((prev) =>
        prev.map((f, i) =>
          i === index ? { ...f, path: newPath, previewCount: null } : f
        )
      );

      const count = await previewFolder(newPath, folder.scanSubfolders);
      setFolders((prev) =>
        prev.map((f, i) => (i === index ? { ...f, previewCount: count } : f))
      );
    },
    [folders, previewFolder]
  );

  const handleRemoveFolder = useCallback((index: number) => {
    setFolders((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleToggleSubfolders = useCallback(
    async (index: number) => {
      const folder = folders[index];
      const next = !folder.scanSubfolders;
      setFolders((prev) =>
        prev.map((f, i) =>
          i === index ? { ...f, scanSubfolders: next, previewCount: null } : f
        )
      );
      const count = await previewFolder(folder.path, next);
      setFolders((prev) =>
        prev.map((f, i) => (i === index ? { ...f, previewCount: count } : f))
      );
    },
    [folders, previewFolder]
  );

  const continueDisabled = useMemo(() => {
    if (currentStep === "find_emulator") return config?.executablePath === null;
    if (currentStep === "firmware") return !firmwareOk;
    if (currentStep === "rom_folder") return folders.length === 0;
    return true;
  }, [currentStep, config, firmwareOk, folders]);

  const continueHidden = currentStep === "scanning" || currentStep === "done";

  if (!visible || !system) return null;

  const handleClose = () => {
    onClose();
  };

  const handleSkip = () => {
    if (currentStep === "firmware") {
      goNext();
    } else if (currentStep === "rom_folder") {
      // skip past scanning and done — emulator path is committed but no folders
      refreshConfig();
      onComplete(system);
    }
  };

  return (
    <Modal
      visible={visible}
      title={
        <div className="setup-modal__header">
          <h2 className="setup-modal__header-title">
            {t("setup_modal_title", { system: systemLabel })}
          </h2>
          <p className="setup-modal__header-subtitle">
            {t(stepLabelKey[currentStep])}
          </p>
        </div>
      }
      onClose={handleClose}
      clickOutsideToClose={false}
    >
      <div className="setup-modal">
        <div className="setup-modal__body">
          {currentStep === "find_emulator" && config && (
            <SetupStepFindEmulator
              config={config}
              onBrowse={handleBrowseExecutable}
            />
          )}
          {currentStep === "firmware" && config && (
            <SetupStepFirmware
              config={config}
              onFirmwareStatusChange={setFirmwareOk}
            />
          )}
          {currentStep === "rom_folder" && (
            <SetupStepRomFolder
              system={system}
              systemLabel={systemLabel}
              folders={folders}
              onAddFolder={handleAddFolder}
              onChangeFolder={handleChangeFolder}
              onRemoveFolder={handleRemoveFolder}
              onToggleSubfolders={handleToggleSubfolders}
            />
          )}
          {currentStep === "scanning" && (
            <SetupStepScanning
              system={system}
              systemLabel={systemLabel}
              folders={folders}
              onComplete={(added) => {
                setGamesAdded(added.matched);
                refreshConfig();
                goNext();
              }}
              onCancel={() => {
                refreshConfig();
                onClose();
              }}
            />
          )}
          {currentStep === "done" && (
            <SetupStepDone
              systemLabel={systemLabel}
              gamesAdded={gamesAdded}
              onBrowse={() => onComplete(system)}
            />
          )}
        </div>

        <SetupFooter
          currentStepIndex={stepIndex}
          totalSteps={steps.length}
          showBack={
            stepIndex > 0 &&
            currentStep !== "scanning" &&
            currentStep !== "done"
          }
          showSkip={currentStep === "firmware" || currentStep === "rom_folder"}
          continueDisabled={continueDisabled}
          continueHidden={continueHidden}
          onBack={goBack}
          onSkip={handleSkip}
          onContinue={goNext}
        />
      </div>
    </Modal>
  );
}
