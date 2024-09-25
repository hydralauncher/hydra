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
  DownloadIcon,
  SyncIcon,
  TrashIcon,
  UploadIcon,
} from "@primer/octicons-react";
import { useToast } from "@renderer/hooks";
import { GameBackup, gameBackupsTable } from "@renderer/dexie";
import { useTranslation } from "react-i18next";

export interface CloudSyncModalProps
  extends Omit<ModalProps, "children" | "title"> {}

export function CloudSyncModal({ visible, onClose }: CloudSyncModalProps) {
  const [deletingArtifact, setDeletingArtifact] = useState(false);
  const [lastBackup, setLastBackup] = useState<GameBackup | null>(null);

  const { t } = useTranslation("game_details");

  const {
    artifacts,
    backupPreview,
    uploadingBackup,
    restoringBackup,
    uploadSaveGame,
    downloadGameArtifact,
    deleteGameArtifact,
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
  }, [backupPreview, objectID, shop]);

  const backupStateLabel = useMemo(() => {
    if (uploadingBackup) {
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SyncIcon />
          {t("uploading_backup")}
        </span>
      );
    }

    if (restoringBackup) {
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SyncIcon />
          {t("restoring_backup")}
        </span>
      );
    }

    if (lastBackup) {
      return (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CheckCircleFillIcon />
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
  }, [uploadingBackup, lastBackup, backupPreview, restoringBackup, t]);

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

      <h2 style={{ marginBottom: 16 }}>{t("backups")}</h2>

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
                onClick={() => downloadGameArtifact(artifact.id)}
                disabled={disableActions}
              >
                <DownloadIcon />
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
