import { Button, Modal, ModalProps } from "@renderer/components";
import { useContext, useEffect, useMemo, useState } from "react";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";

import * as styles from "./cloud-sync-modal.css";
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
import { useToast } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { AxiosProgressEvent } from "axios";
import { formatDownloadProgress } from "@renderer/helpers";
import { SPACING_UNIT } from "@renderer/theme.css";

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

  const backupStateLabel = useMemo(() => {
    if (uploadingBackup) {
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SyncIcon className={styles.syncIcon} />
          {t("uploading_backup")}
        </span>
      );
    }

    if (restoringBackup) {
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SyncIcon className={styles.syncIcon} />
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
          <SyncIcon className={styles.syncIcon} />
          {t("loading_save_preview")}
        </span>
      );
    }

    if (artifacts.length >= 2) {
      return t("max_number_of_artifacts_reached");
    }

    if (!backupPreview) {
      return t("no_backup_preview");
    }

    return t("no_backups");
  }, [
    uploadingBackup,
    backupDownloadProgress?.progress,
    backupPreview,
    restoringBackup,
    loadingPreview,
    artifacts,
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
      <div
        style={{
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: 4, flexDirection: "column" }}>
          <h2>{gameTitle}</h2>
          <p>{backupStateLabel}</p>

          <button
            type="button"
            className={styles.manageFilesButton}
            onClick={() => setShowCloudSyncFilesModal(true)}
            disabled={disableActions || !backupPreview?.overall.totalGames}
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
            artifacts.length >= 2
          }
        >
          <UploadIcon />
          {t("create_backup")}
        </Button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div
          style={{
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: SPACING_UNIT,
          }}
        >
          <h2>{t("backups")}</h2>
          <small>{artifacts.length} / 2</small>
        </div>
      </div>

      {artifacts.length > 0 ? (
        <ul className={styles.artifacts}>
          {artifacts.map((artifact, index) => (
            <li key={artifact.id} className={styles.artifactButton}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <h3>{t("backup_title", { number: index + 1 })}</h3>
                  <small>{formatBytes(artifact.artifactLengthInBytes)}</small>
                </div>

                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <DeviceDesktopIcon size={14} />
                  {artifact.hostname}
                </span>

                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <InfoIcon size={14} />
                  {artifact.downloadOptionTitle ?? t("no_download_option_info")}
                </span>

                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ClockIcon size={14} />
                  {format(artifact.createdAt, "dd/MM/yyyy HH:mm:ss")}
                </span>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Button
                  type="button"
                  onClick={() => handleBackupInstallClick(artifact.id)}
                  disabled={disableActions}
                >
                  <HistoryIcon />
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
