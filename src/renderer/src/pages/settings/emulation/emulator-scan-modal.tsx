import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal } from "@renderer/components";
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
  unmatchedFiles: string[];
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

  const [scanStats, setScanStats] = useState<ScanCompletion | null>(null);

  useEffect(() => {
    if (visible) setScanStats(null);
  }, [visible]);

  const handleComplete = useCallback((stats: ScanCompletion) => {
    setScanStats(stats);
  }, []);

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
        </div>
      }
      onClose={onCancel}
      clickOutsideToClose={false}
    >
      <div className="setup-modal">
        <div className="setup-modal__body">
          <SetupStepScanning
            system={system}
            systemLabel={system.toUpperCase()}
            folders={pendingFolders}
            onComplete={handleComplete}
          />
        </div>

        <div className="setup-modal__footer">
          <div className="setup-modal__footer-side" />
          <div className="setup-modal__footer-side setup-modal__footer-side--end">
            {!scanStats && (
              <button
                type="button"
                className="setup-modal__ghost-button"
                onClick={onCancel}
              >
                {t("setup_cancel_scan")}
              </button>
            )}
            <Button
              theme="primary"
              disabled={!scanStats}
              onClick={() => {
                if (scanStats) onComplete(scanStats);
              }}
            >
              {t("setup_continue")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
