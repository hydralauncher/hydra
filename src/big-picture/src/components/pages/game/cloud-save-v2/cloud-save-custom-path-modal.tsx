import {
  CloudArrowDownIcon,
  FolderOpenIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { CloudSaveCustomPathApproval } from "@types";
import { Trans, useTranslation } from "react-i18next";

import { formatBytes } from "@shared";
import {
  Button,
  FileExplorerModal,
  Modal,
  VerticalFocusGroup,
} from "../../../common";

const APPROVAL_REGION_ID = "big-picture-cloud-save-path-approval";
const SELECT_BUTTON_ID = "big-picture-cloud-save-path-select";

interface BigPictureCloudSaveCustomPathModalProps {
  approval: CloudSaveCustomPathApproval | null;
  isSelecting: boolean;
  isConfirming: boolean;
  isFileExplorerVisible: boolean;
  errorMessage?: string;
  onOpenFileExplorer: () => void;
  onCloseFileExplorer: () => void;
  onSelectPath: (path: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function BigPictureCloudSaveCustomPathModal({
  approval,
  isSelecting,
  isConfirming,
  isFileExplorerVisible,
  errorMessage,
  onOpenFileExplorer,
  onCloseFileExplorer,
  onSelectPath,
  onConfirm,
  onClose,
}: Readonly<BigPictureCloudSaveCustomPathModalProps>) {
  const { t } = useTranslation("game_details");
  const isBusy = isSelecting || isConfirming;
  const displayedPath = approval?.selectedPath ?? approval?.suggestedPath ?? "";
  const isManualSync = approval?.purpose === "manual-sync";
  const isCustomPathRebind = approval?.purpose === "custom-path-rebind";
  const hasRemoteFiles = (approval?.fileCount ?? 0) > 0;
  const descriptionKey = isManualSync
    ? "cloud_save_v2_path_approval_manual_sync_description"
    : isCustomPathRebind
      ? "cloud_save_v2_path_approval_rebind_description"
      : "cloud_save_v2_path_approval_description";
  const confirmKey = isManualSync
    ? isConfirming
      ? "cloud_save_v2_path_approval_manual_sync_running"
      : "cloud_save_v2_path_approval_manual_sync_confirm"
    : isCustomPathRebind
      ? isConfirming
        ? "cloud_save_v2_path_approval_rebind_running"
        : "cloud_save_v2_path_approval_rebind_confirm"
      : isConfirming
        ? "cloud_save_v2_path_approval_restoring"
        : "cloud_save_v2_path_approval_confirm";

  return (
    <>
      <Modal
        visible={approval !== null}
        title={t("cloud_save_v2_path_approval_title")}
        onClose={onClose}
        closeOnBackdrop={!isBusy}
        closeOnEscape={!isBusy}
        closeOnB={!isBusy}
        initialFocusId={SELECT_BUTTON_ID}
        className="big-picture-cloud-save-path-modal"
      >
        <VerticalFocusGroup
          regionId={APPROVAL_REGION_ID}
          className="big-picture-cloud-save-path"
        >
          {hasRemoteFiles ? (
            <div className="big-picture-cloud-save-path__warning">
              <WarningCircleIcon size={22} weight="fill" />
              <span>{t("cloud_save_v2_path_approval_warning")}</span>
            </div>
          ) : null}

          <p className="big-picture-cloud-save-path__description">
            <Trans t={t} i18nKey={descriptionKey} />
          </p>

          {hasRemoteFiles && approval ? (
            <div className="big-picture-cloud-save-path__summary">
              <CloudArrowDownIcon size={24} weight="duotone" />
              <span>
                {t("cloud_save_v2_path_approval_file_summary", {
                  count: approval.fileCount,
                  size: formatBytes(approval.totalSizeBytes),
                })}
              </span>
            </div>
          ) : null}

          <div className="big-picture-cloud-save-path__destination">
            <span className="big-picture-cloud-save-path__label">
              {t("cloud_save_v2_path_approval_destination")}
            </span>
            <div className="big-picture-cloud-save-path__path-row">
              <div
                className="big-picture-cloud-save-path__path"
                title={displayedPath}
              >
                {displayedPath ||
                  t("cloud_save_v2_path_approval_destination_unavailable")}
              </div>
              <Button
                focusId={SELECT_BUTTON_ID}
                variant="secondary"
                icon={<FolderOpenIcon size={22} />}
                disabled={isBusy}
                loading={isSelecting}
                onClick={onOpenFileExplorer}
              >
                {t("cloud_save_v2_path_approval_choose")}
              </Button>
            </div>
            {!approval?.selectedPath ? (
              <span className="big-picture-cloud-save-path__hint">
                {t("cloud_save_v2_path_approval_destination_unavailable")}
              </span>
            ) : null}
            {errorMessage ? (
              <span className="big-picture-cloud-save-path__error">
                {errorMessage}
              </span>
            ) : null}
          </div>

          <div className="big-picture-cloud-save-path__actions">
            <Button
              variant="primary"
              disabled={isBusy || !approval?.selectedPath}
              loading={isConfirming}
              onClick={onConfirm}
            >
              {t(confirmKey)}
            </Button>
          </div>
        </VerticalFocusGroup>
      </Modal>

      <FileExplorerModal
        visible={approval !== null && isFileExplorerVisible}
        title={t("cloud_save_v2_path_approval_destination")}
        initialPath={
          approval?.selectedPath ??
          (approval?.canUseSuggestedPath
            ? (approval.suggestedPath ?? undefined)
            : undefined)
        }
        selectDirectory
        onClose={onCloseFileExplorer}
        onSelect={onSelectPath}
      />
    </>
  );
}
