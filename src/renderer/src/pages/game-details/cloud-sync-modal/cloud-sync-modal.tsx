import { Button, Modal, ModalProps } from "@renderer/components";
import { useContext, useEffect, useMemo, useState } from "react";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";

import "./cloud-sync-modal.scss";
import { formatBytes } from "@shared";
import { format } from "date-fns";
import {
  ClockIcon,
  DeviceDesktopIcon,
  HistoryIcon,
  InfoIcon,
  SyncIcon,
  TrashIcon,
  UploadIcon,
} from "@primer/octicons-react";
import { useAppSelector, useToast } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { AxiosProgressEvent } from "axios";
import { formatDownloadProgress } from "@renderer/helpers";

export interface CloudSyncModalProps
  extends Omit<ModalProps, "children" | "title"> {}

export function CloudSyncModal({ visible, onClose }: CloudSyncModalProps) {
  const [deletingArtifact, setDeletingArtifact] = useState(false);
  const [backupDownloadProgress, setBackupDownloadProgress] =
    useState<AxiosProgressEvent | null>(null);

  const { t } = useTranslation("game_details");

  const {
    artifacts,
    backupPreview,
    uploadingBackup,
    restoringBackup,
    loadingPreview,
    uploadSaveGame,
    downloadGameArtifact,
    deleteGameArtifact,
    setShowCloudSyncFilesModal,
    getGameBackupPreview,
  } = useContext(cloudSyncContext);

  const { objectId, shop, gameTitle, lastDownloadedOption } =
    useContext(gameDetailsContext);

  const { showSuccessToast, showErrorToast } = useToast();

  const handleDeleteArtifactClick = async (gameArtifactId: string) => {
    setDeletingArtifact(true);

    try {
      await deleteGameArtifact(gameArtifactId);

      showSuccessToast(t("backup_deleted"));
    } catch (err) {
      showErrorToast("backup_deletion_failed");
    } finally {
      setDeletingArtifact(false);
    }
  };

  useEffect(() => {
    const removeBackupDownloadProgressListener =
      window.electron.onBackupDownloadProgress(
        objectId!,
        shop,
        (progressEvent) => {
          setBackupDownloadProgress(progressEvent);
        }
      );

    return () => {
      removeBackupDownloadProgressListener();
    };
  }, [backupPreview, objectId, shop]);

  const handleBackupInstallClick = async (artifactId: string) => {
    setBackupDownloadProgress(null);
    downloadGameArtifact(artifactId);
  };

  useEffect(() => {
    if (visible) {
      getGameBackupPreview();
    }
  }, [getGameBackupPreview, visible]);

  const userDetails = useAppSelector((state) => state.userDetails.userDetails);
  const backupsPerGameLimit = userDetails?.quirks?.backupsPerGameLimit ?? 0;

  const backupStateLabel = useMemo(() => {
    if (uploadingBackup) {
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SyncIcon className="cloud-sync-modal__sync-icon" />
          {t("uploading_backup")}
        </span>
      );
    }

    if (restoringBackup) {
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SyncIcon className="cloud-sync-modal__sync-icon" />
          {t("restoring_backup", {
            progress: formatDownloadProgress(
              backupDownloadProgress?.progress ?? 0
            ),
          })}
        </span>
      );
    }

    if (loadingPreview) {
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SyncIcon className="cloud-sync-modal__sync-icon" />
          {t("loading_save_preview")}
        </span>
      );
    }

    if (artifacts.length >= backupsPerGameLimit) {
      return t("max_number_of_artifacts_reached");
    }

    if (!backupPreview) {
      return t("no_backup_preview");
    }

    if (artifacts.length === 0) {
      return t("no_backups");
    }

    return "";
  }, [
    uploadingBackup,
    backupDownloadProgress?.progress,
    backupPreview,
    restoringBackup,
    loadingPreview,
    artifacts,
    backupsPerGameLimit,
    t,
  ]);

  const disableActions = uploadingBackup || restoringBackup || deletingArtifact;

  return (
    <Modal
      visible={visible}
      title={t("cloud_save")}
      description={t("cloud_save_description")}
      onClose={onClose}
      large
    >
      <div className="cloud-sync-modal__header">
        <div className="cloud-sync-modal__title-container">
          <h2>{gameTitle}</h2>
          <p>{backupStateLabel}</p>

          <button
            type="button"
            className="cloud-sync-modal__manage-files-button"
            onClick={() => setShowCloudSyncFilesModal(true)}
            disabled={disableActions}
          >
            {t("manage_files")}
          </button>
        </div>

        <Button
          type="button"
          onClick={() => uploadSaveGame(lastDownloadedOption?.title ?? null)}
          disabled={
            disableActions ||
            !backupPreview?.overall.totalGames ||
            artifacts.length >= backupsPerGameLimit
          }
        >
          {uploadingBackup ? (
            <SyncIcon className="cloud-sync-modal__sync-icon" />
          ) : (
            <UploadIcon />
          )}
          {t("create_backup")}
        </Button>
      </div>

      <div className="cloud-sync-modal__backups-header">
        <h2>{t("backups")}</h2>
        <small>
          {artifacts.length} / {backupsPerGameLimit}
        </small>
      </div>

      {artifacts.length > 0 ? (
        <ul className="cloud-sync-modal__artifacts">
          {artifacts.map((artifact) => (
            <li key={artifact.id} className="cloud-sync-modal__artifact">
              <div className="cloud-sync-modal__artifact-info">
                <div className="cloud-sync-modal__artifact-header">
                  <h3>
                    {t("backup_from", {
                      date: format(artifact.createdAt, "dd/MM/yyyy"),
                    })}
                  </h3>
                  <small>{formatBytes(artifact.artifactLengthInBytes)}</small>
                </div>

                <span className="cloud-sync-modal__artifact-meta">
                  <DeviceDesktopIcon size={14} />
                  {artifact.hostname}
                </span>

                <span className="cloud-sync-modal__artifact-meta">
                  <InfoIcon size={14} />
                  {artifact.downloadOptionTitle ?? t("no_download_option_info")}
                </span>

                <span className="cloud-sync-modal__artifact-meta">
                  <ClockIcon size={14} />
                  {format(artifact.createdAt, "dd/MM/yyyy HH:mm:ss")}
                </span>
              </div>

              <div className="cloud-sync-modal__artifact-actions">
                <Button
                  type="button"
                  onClick={() => handleBackupInstallClick(artifact.id)}
                  disabled={disableActions}
                >
                  {restoringBackup ? (
                    <SyncIcon className="cloud-sync-modal__sync-icon" />
                  ) : (
                    <HistoryIcon />
                  )}
                  {t("install_backup")}
                </Button>
                <Button
                  type="button"
                  onClick={() => handleDeleteArtifactClick(artifact.id)}
                  theme="danger"
                  disabled={disableActions}
                >
                  <TrashIcon />
                  {t("delete_backup")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("no_backups_created")}</p>
      )}
    </Modal>
  );
}
