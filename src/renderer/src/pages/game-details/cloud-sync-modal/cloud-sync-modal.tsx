import { Button, Modal, ModalProps } from "@renderer/components";
import { useContext, useEffect, useMemo, useState } from "react";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";

import * as styles from "./cloud-sync-modal.css";
import { formatBytes } from "@shared";
import { format } from "date-fns";
import {
  CheckCircleFillIcon,
  ClockIcon,
  DeviceDesktopIcon,
  HistoryIcon,
  SyncIcon,
  TrashIcon,
  UploadIcon,
} from "@primer/octicons-react";
import { useToast } from "@renderer/hooks";
import { GameBackup, gameBackupsTable } from "@renderer/dexie";
import { useTranslation } from "react-i18next";
import { AxiosProgressEvent } from "axios";
import { formatDownloadProgress } from "@renderer/helpers";
import { SPACING_UNIT, vars } from "@renderer/theme.css";

export interface CloudSyncModalProps
  extends Omit<ModalProps, "children" | "title"> {}

export function CloudSyncModal({ visible, onClose }: CloudSyncModalProps) {
  const [deletingArtifact, setDeletingArtifact] = useState(false);
  const [lastBackup, setLastBackup] = useState<GameBackup | null>(null);
  const [backupDownloadProgress, setBackupDownloadProgress] =
    useState<AxiosProgressEvent | null>(null);

  const { t } = useTranslation("game_details");

  const {
    artifacts,
    backupPreview,
    uploadingBackup,
    restoringBackup,
    uploadSaveGame,
    downloadGameArtifact,
    deleteGameArtifact,
    setShowCloudSyncFilesModal,
  } = useContext(cloudSyncContext);

  const { objectID, shop, gameTitle } = useContext(gameDetailsContext);

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
    gameBackupsTable
      .where({ shop: shop, objectId: objectID })
      .last()
      .then((lastBackup) => setLastBackup(lastBackup || null));

    const removeBackupDownloadProgressListener =
      window.electron.onBackupDownloadProgress(
        objectID!,
        shop,
        (progressEvent) => {
          setBackupDownloadProgress(progressEvent);
        }
      );

    return () => {
      removeBackupDownloadProgressListener();
    };
  }, [backupPreview, objectID, shop]);

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

    if (lastBackup) {
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <i style={{ color: vars.color.success }}>
            <CheckCircleFillIcon />
          </i>

          {t("last_backup_date", {
            date: format(lastBackup.createdAt, "dd/MM/yyyy HH:mm"),
          })}
        </span>
      );
    }

    if (!backupPreview) {
      return t("no_backup_preview");
    }

    return t("no_backups");
  }, [
    uploadingBackup,
    backupDownloadProgress?.progress,
    lastBackup,
    backupPreview,
    restoringBackup,
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
            style={{
              margin: 0,
              padding: 0,
              alignSelf: "flex-start",
              fontSize: 14,
              cursor: "pointer",
              textDecoration: "underline",
              color: vars.color.body,
            }}
            onClick={() => setShowCloudSyncFilesModal(true)}
          >
            Gerenciar arquivos
          </button>
        </div>

        <Button
          type="button"
          onClick={uploadSaveGame}
          disabled={disableActions || !backupPreview}
        >
          <UploadIcon />
          {t("create_backup")}
        </Button>
      </div>

      <div
        style={{
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: SPACING_UNIT,
        }}
      >
        <h2>{t("backups")}</h2>
        <small>2 / 2</small>
      </div>

      <ul className={styles.artifacts}>
        {artifacts.map((artifact) => (
          <li key={artifact.id} className={styles.artifactButton}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <h3>Backup do dia {format(artifact.createdAt, "dd/MM")}</h3>
                <small>{formatBytes(artifact.artifactLengthInBytes)}</small>
              </div>

              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <DeviceDesktopIcon size={14} />
                {artifact.hostname}
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
    </Modal>
  );
}
