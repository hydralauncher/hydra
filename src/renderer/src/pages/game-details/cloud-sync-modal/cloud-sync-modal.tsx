import { Button, Modal, ModalProps } from "@renderer/components";
import { useContext, useEffect, useMemo, useState } from "react";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";
import "./cloud-sync-modal.scss";
import { formatBytes } from "@shared";
import {
  ClockIcon,
  DeviceDesktopIcon,
  HistoryIcon,
  InfoIcon,
  PencilIcon,
  PinIcon,
  PinSlashIcon,
  SyncIcon,
  TrashIcon,
  UploadIcon,
} from "@primer/octicons-react";
import { useAppSelector, useDate, useToast } from "@renderer/hooks";
import { useTranslation } from "react-i18next";
import { AxiosProgressEvent } from "axios";
import { formatDownloadProgress } from "@renderer/helpers";
import { CloudSyncRenameArtifactModal } from "../cloud-sync-rename-artifact-modal/cloud-sync-rename-artifact-modal";
import { GameArtifact } from "@types";
import { motion, AnimatePresence } from "framer-motion";
import { orderBy } from "lodash-es";

export interface CloudSyncModalProps
  extends Omit<ModalProps, "children" | "title"> {}

export function CloudSyncModal({ visible, onClose }: CloudSyncModalProps) {
  const [deletingArtifact, setDeletingArtifact] = useState(false);
  const [backupDownloadProgress, setBackupDownloadProgress] =
    useState<AxiosProgressEvent | null>(null);
  const [artifactToRename, setArtifactToRename] = useState<GameArtifact | null>(
    null
  );

  const { t } = useTranslation("game_details");
  const { formatDate, formatDateTime } = useDate();

  const {
    artifacts,
    backupPreview,
    uploadingBackup,
    restoringBackup,
    loadingPreview,
    freezingArtifact,
    uploadSaveGame,
    downloadGameArtifact,
    deleteGameArtifact,
    toggleArtifactFreeze,
    setShowCloudSyncFilesModal,
    getGameBackupPreview,
  } = useContext(cloudSyncContext);

  const { objectId, shop, gameTitle, game, lastDownloadedOption } =
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

  const handleFreezeArtifactClick = async (
    artifactId: string,
    isFrozen: boolean
  ) => {
    try {
      await toggleArtifactFreeze(artifactId, isFrozen);
      showSuccessToast(isFrozen ? t("backup_frozen") : t("backup_unfrozen"));
    } catch (err) {
      showErrorToast(
        t("backup_freeze_failed"),
        t("backup_freeze_failed_description")
      );
    }
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
        <span className="cloud-sync-modal__backup-state-label">
          <SyncIcon className="cloud-sync-modal__sync-icon" />
          {t("uploading_backup")}
        </span>
      );
    }
    if (restoringBackup) {
      return (
        <span className="cloud-sync-modal__backup-state-label">
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
        <span className="cloud-sync-modal__backup-state-label">
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

  const disableActions =
    uploadingBackup || restoringBackup || deletingArtifact || freezingArtifact;
  const isMissingWinePrefix =
    window.electron.platform === "linux" && !game?.winePrefixPath;

  return (
    <>
      <CloudSyncRenameArtifactModal
        visible={!!artifactToRename}
        onClose={() => setArtifactToRename(null)}
        artifact={artifactToRename}
      />

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
            tooltip={isMissingWinePrefix ? t("missing_wine_prefix") : undefined}
            tooltipPlace="left"
            disabled={
              disableActions ||
              !backupPreview?.overall.totalGames ||
              artifacts.length >= backupsPerGameLimit ||
              isMissingWinePrefix
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
            <AnimatePresence>
              {orderBy(artifacts, [(a) => !a.isFrozen], ["asc"]).map(
                (artifact) => (
                  <motion.li
                    key={artifact.id}
                    className="cloud-sync-modal__artifact"
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="cloud-sync-modal__artifact-info">
                      <div className="cloud-sync-modal__artifact-header">
                        <button
                          type="button"
                          className="cloud-sync-modal__artifact-label"
                          onClick={() => setArtifactToRename(artifact)}
                        >
                          {artifact.label ??
                            t("backup_from", {
                              date: formatDate(artifact.createdAt),
                            })}
                          <PencilIcon />
                        </button>
                        <small>
                          {formatBytes(artifact.artifactLengthInBytes)}
                        </small>
                      </div>

                      <span className="cloud-sync-modal__artifact-meta">
                        <DeviceDesktopIcon size={14} />
                        {artifact.hostname}
                      </span>

                      <span className="cloud-sync-modal__artifact-meta">
                        <InfoIcon size={14} />
                        {artifact.downloadOptionTitle ??
                          t("no_download_option_info")}
                      </span>

                      <span className="cloud-sync-modal__artifact-meta">
                        <ClockIcon size={14} />
                        {formatDateTime(artifact.createdAt)}
                      </span>
                    </div>

                    <div className="cloud-sync-modal__artifact-actions">
                      <Button
                        type="button"
                        tooltip={
                          artifact.isFrozen
                            ? t("unfreeze_backup")
                            : t("freeze_backup")
                        }
                        theme={artifact.isFrozen ? "primary" : "outline"}
                        onClick={() =>
                          handleFreezeArtifactClick(
                            artifact.id,
                            !artifact.isFrozen
                          )
                        }
                        disabled={disableActions}
                      >
                        {artifact.isFrozen ? <PinSlashIcon /> : <PinIcon />}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => handleBackupInstallClick(artifact.id)}
                        disabled={disableActions}
                        theme="outline"
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
                        disabled={disableActions || artifact.isFrozen}
                        theme="outline"
                        tooltip={t("delete_backup")}
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                  </motion.li>
                )
              )}
            </AnimatePresence>
          </ul>
        ) : (
          <p>{t("no_backups_created")}</p>
        )}
      </Modal>
    </>
  );
}
