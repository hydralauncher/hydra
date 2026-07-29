import {
  CircleNotchIcon,
  CloudArrowDownIcon,
  FolderOpenIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import { formatBytes } from "@shared";
import type { CloudSaveCustomPathApproval } from "@types";

interface CloudSaveCustomPathApprovalModalProps {
  approval: CloudSaveCustomPathApproval | null;
  isSelecting: boolean;
  isConfirming: boolean;
  hasError: boolean;
  onSelectPath: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function CloudSaveCustomPathApprovalModal({
  approval,
  isSelecting,
  isConfirming,
  hasError,
  onSelectPath,
  onConfirm,
  onClose,
}: Readonly<CloudSaveCustomPathApprovalModalProps>) {
  const { t } = useTranslation("game_details");
  const isBusy = isSelecting || isConfirming;
  const displayedPath = approval?.selectedPath ?? approval?.suggestedPath ?? "";

  return (
    <Modal
      visible={approval !== null}
      title={t("cloud_save_v2_path_approval_title")}
      description={t("cloud_save_v2_path_approval_description")}
      className="cloud-save-v2__path-approval-modal"
      clickOutsideToClose={!isBusy}
      onClose={() => {
        if (!isBusy) onClose();
      }}
    >
      <div className="cloud-save-v2__path-approval">
        <div className="cloud-save-v2__path-approval-summary">
          <CloudArrowDownIcon size={22} weight="duotone" />
          <span>
            {approval
              ? t("cloud_save_v2_path_approval_file_summary", {
                  count: approval.fileCount,
                  size: formatBytes(approval.totalSizeBytes),
                })
              : null}
          </span>
        </div>

        <TextField
          readOnly
          value={displayedPath}
          label={t("cloud_save_v2_path_approval_destination")}
          hint={
            approval?.selectedPath
              ? t("cloud_save_v2_path_approval_destination_hint")
              : t("cloud_save_v2_path_approval_destination_unavailable")
          }
          error={
            hasError
              ? t("cloud_save_v2_path_approval_error_description")
              : undefined
          }
        />

        <div className="cloud-save-v2__path-approval-warning">
          <WarningCircleIcon size={20} weight="fill" />
          <span>{t("cloud_save_v2_path_approval_warning")}</span>
        </div>

        <div className="cloud-save-v2__path-approval-actions">
          <Button theme="outline" onClick={onSelectPath} disabled={isBusy}>
            {isSelecting ? (
              <CircleNotchIcon className="cloud-save-v2__spinner" size={18} />
            ) : (
              <FolderOpenIcon size={18} />
            )}
            <span>{t("cloud_save_v2_path_approval_choose")}</span>
          </Button>

          <Button
            theme="primary"
            onClick={onConfirm}
            disabled={isBusy || !approval?.selectedPath}
          >
            {isConfirming && (
              <CircleNotchIcon className="cloud-save-v2__spinner" size={18} />
            )}
            <span>
              {isConfirming
                ? t("cloud_save_v2_path_approval_restoring")
                : t("cloud_save_v2_path_approval_confirm")}
            </span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
