import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Modal } from "@renderer/components";
import type { EmulatorSystem } from "@types";

import { SetupStepScanning } from "./setup/setup-step-scanning";
import type { PendingFolder } from "./setup/types";

import "./setup/setup-shell.scss";

export interface ScanFolderInput {
  path: string;
  scanSubfolders: boolean;
}

export interface ScanCompletion {
  fileCount: number;
  sizeBytes: number;
  matched: number;
  unmatched: number;
}

interface Props {
  visible: boolean;
  system: EmulatorSystem;
  systemLabel: string;
  folders: ScanFolderInput[];
  onComplete: (stats: ScanCompletion) => void;
  onCancel: () => void;
}

export function EmulatorScanModal({
  visible,
  system,
  systemLabel,
  folders,
  onComplete,
  onCancel,
}: Readonly<Props>) {
  const { t } = useTranslation("settings");

  const handleComplete = useCallback(
    (stats: ScanCompletion) => {
      onComplete(stats);
    },
    [onComplete]
  );

  const pendingFolders: PendingFolder[] = folders.map((f) => ({
    path: f.path,
    scanSubfolders: f.scanSubfolders,
    previewCount: null,
  }));

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      title={
        <div className="setup-modal__header">
          <h2 className="setup-modal__header-title">
            {t("setup_modal_title", { system: systemLabel })}
          </h2>
          <p className="setup-modal__header-subtitle">
            {t("setup_step_label_scanning")}
          </p>
        </div>
      }
      onClose={onCancel}
      clickOutsideToClose={false}
    >
      <div className="setup-modal">
        <div className="setup-modal__body">
          <SetupStepScanning
            system={system}
            systemLabel={systemLabel}
            folders={pendingFolders}
            onComplete={handleComplete}
            onCancel={onCancel}
          />
        </div>
      </div>
    </Modal>
  );
}
