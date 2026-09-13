import { useTranslation } from "react-i18next";

import { Button, Modal } from "@renderer/components";
import { useRetroArchScan } from "@renderer/hooks";

import { SetupStepScanning } from "./setup/setup-step-scanning";
import { RETROARCH_LABEL } from "./retroarch-meta";

import "./setup/setup-shell.scss";

export function RetroArchScanModal() {
  const { t } = useTranslation("settings");
  const { scan, closeModal, cancel } = useRetroArchScan();

  if (!scan.modalVisible) return null;

  const isDone = scan.phase === "done";

  return (
    <Modal
      visible
      title={
        <div className="setup-modal__header">
          <h2 className="setup-modal__header-title">
            {t("setup_modal_title", { system: RETROARCH_LABEL })}
          </h2>
        </div>
      }
      onClose={closeModal}
      clickOutsideToClose={false}
    >
      <div className="setup-modal">
        <div className="setup-modal__body">
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
        </div>

        <div className="setup-modal__footer setup-modal__footer--single-line">
          <div className="setup-modal__footer-side" />
          <div className="setup-modal__footer-side setup-modal__footer-side--end">
            {scan.active && (
              <>
                <Button theme="outline" onClick={cancel}>
                  {t("setup_cancel_scan")}
                </Button>
                <Button theme="outline" onClick={closeModal}>
                  {t("setup_run_in_background")}
                </Button>
              </>
            )}
            {isDone && (
              <Button theme="primary" onClick={closeModal}>
                {t("setup_continue")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
