import {
  CaretDownIcon,
  CircleNotchIcon,
  CloudArrowDownIcon,
  FolderOpenIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import { Button, Modal, TextField } from "@renderer/components";
import { useDate } from "@renderer/hooks";
import { formatBytes } from "@shared";
import type { CloudSaveCustomPathApproval } from "@types";

interface CloudSaveCustomPathApprovalModalProps {
  approval: CloudSaveCustomPathApproval | null;
  isSelecting: boolean;
  isConfirming: boolean;
  errorMessage?: string;
  onSelectPath: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

type ApprovalPurpose = CloudSaveCustomPathApproval["purpose"] | undefined;

const getApprovalDescriptionKey = (purpose: ApprovalPurpose) => {
  if (purpose === "manual-sync") {
    return "cloud_save_v2_path_approval_manual_sync_description";
  }
  if (purpose === "custom-path-rebind") {
    return "cloud_save_v2_path_approval_rebind_description";
  }
  return "cloud_save_v2_path_approval_description";
};

const getApprovalActionKey = (
  purpose: ApprovalPurpose,
  isConfirming: boolean
) => {
  if (isConfirming) {
    if (purpose === "manual-sync") {
      return "cloud_save_v2_path_approval_manual_sync_running";
    }
    if (purpose === "custom-path-rebind") {
      return "cloud_save_v2_path_approval_rebind_running";
    }
    return "cloud_save_v2_path_approval_restoring";
  }

  if (purpose === "manual-sync") {
    return "cloud_save_v2_path_approval_manual_sync_confirm";
  }
  if (purpose === "custom-path-rebind") {
    return "cloud_save_v2_path_approval_rebind_confirm";
  }
  return "cloud_save_v2_path_approval_confirm";
};

export function CloudSaveCustomPathApprovalModal({
  approval,
  isSelecting,
  isConfirming,
  errorMessage,
  onSelectPath,
  onConfirm,
  onClose,
}: Readonly<CloudSaveCustomPathApprovalModalProps>) {
  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();
  const [areFilesExpanded, setAreFilesExpanded] = useState(false);
  const isBusy = isSelecting || isConfirming;
  const displayedPath = approval?.selectedPath ?? approval?.suggestedPath ?? "";
  const hasRemoteFiles = (approval?.fileCount ?? 0) > 0;
  const descriptionKey = getApprovalDescriptionKey(approval?.purpose);
  const actionKey = getApprovalActionKey(approval?.purpose, isConfirming);
  const fileListId = approval
    ? `cloud-save-path-approval-files-${approval.id}`
    : undefined;

  useEffect(() => {
    setAreFilesExpanded(false);
  }, [approval?.id]);

  return (
    <Modal
      visible={approval !== null}
      title={t("cloud_save_v2_path_approval_title")}
      className="cloud-save-v2__path-approval-modal"
      clickOutsideToClose={!isBusy}
      onClose={() => {
        if (!isBusy) onClose();
      }}
    >
      <div className="cloud-save-v2__path-approval">
        {hasRemoteFiles && (
          <div className="cloud-save-v2__path-approval-warning">
            <WarningCircleIcon size={20} weight="fill" />
            <span>{t("cloud_save_v2_path_approval_warning")}</span>
          </div>
        )}

        <p className="cloud-save-v2__path-approval-description">
          <Trans t={t} i18nKey={descriptionKey} />
        </p>

        {hasRemoteFiles && (
          <div className="cloud-save-v2__path-approval-summary">
            <button
              type="button"
              className="cloud-save-v2__path-approval-summary-toggle"
              aria-expanded={areFilesExpanded}
              aria-controls={fileListId}
              onClick={() => setAreFilesExpanded((expanded) => !expanded)}
            >
              <CloudArrowDownIcon size={22} weight="duotone" />
              <span>
                {approval
                  ? t("cloud_save_v2_path_approval_file_summary", {
                      count: approval.fileCount,
                      size: formatBytes(approval.totalSizeBytes),
                    })
                  : null}
              </span>
              <CaretDownIcon
                className={`cloud-save-v2__path-approval-summary-chevron ${
                  areFilesExpanded
                    ? "cloud-save-v2__path-approval-summary-chevron--expanded"
                    : ""
                }`}
                size={16}
                weight="bold"
              />
            </button>

            {areFilesExpanded && approval && (
              <div
                id={fileListId}
                className="cloud-save-v2__path-approval-files"
              >
                {approval.files.map((file, index) => (
                  <div
                    className="cloud-save-v2__path-approval-file"
                    key={`${file.relativePath}:${file.lastModifiedAt}:${index}`}
                  >
                    <span
                      className="cloud-save-v2__path-approval-file-name"
                      title={file.relativePath}
                    >
                      {file.name}
                    </span>
                    <span className="cloud-save-v2__path-approval-file-size">
                      {formatBytes(file.sizeBytes)}
                    </span>
                    <span className="cloud-save-v2__path-approval-file-date">
                      {formatDateTime(file.lastModifiedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <TextField
          readOnly
          value={displayedPath}
          label={t("cloud_save_v2_path_approval_destination")}
          hint={
            approval?.selectedPath
              ? undefined
              : t("cloud_save_v2_path_approval_destination_unavailable")
          }
          error={errorMessage}
          rightContent={
            <Button
              className="cloud-save-v2__path-approval-choose"
              theme="outline"
              onClick={onSelectPath}
              disabled={isBusy}
            >
              {isSelecting ? (
                <CircleNotchIcon className="cloud-save-v2__spinner" size={18} />
              ) : (
                <FolderOpenIcon size={18} />
              )}
              <span>{t("cloud_save_v2_path_approval_choose")}</span>
            </Button>
          }
        />

        <div className="cloud-save-v2__path-approval-actions">
          <Button
            theme="primary"
            onClick={onConfirm}
            disabled={isBusy || !approval?.selectedPath}
          >
            {isConfirming && (
              <CircleNotchIcon className="cloud-save-v2__spinner" size={18} />
            )}
            <span>{t(actionKey)}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
