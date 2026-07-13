import { type ReactNode, useMemo } from "react";
import { SyncIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import type {
  CloudSaveOverview,
  CloudSaveConflictResolution,
  CloudSaveState,
  CloudSaveSyncProgressPayload,
} from "@types";
import { formatBytes } from "@shared";
import { Button, Modal } from "@renderer/components";
import { useDate } from "@renderer/hooks";

interface CloudSaveModalProps {
  visible: boolean;
  overview: CloudSaveOverview | null;
  isLoading: boolean;
  isSyncing: boolean;
  hasError: boolean;
  progress: CloudSaveSyncProgressPayload | null;
  onSync: () => void;
  onResolveConflict: (resolution: CloudSaveConflictResolution) => void;
  onClose: () => void;
}

const stateKey: Record<CloudSaveState, string> = {
  synced: "cloud_save_v2_synced",
  "local-ahead": "cloud_save_v2_outdated",
  "remote-ahead": "cloud_save_v2_outdated",
  conflict: "cloud_save_v2_conflict",
  untracked: "cloud_save_v2_not_synced",
};

const stateDescriptionKey: Partial<Record<CloudSaveState, string>> = {
  "local-ahead": "cloud_save_v2_local_ahead_description",
  "remote-ahead": "cloud_save_v2_remote_ahead_description",
  conflict: "cloud_save_v2_conflict_description",
};

export function CloudSaveModal({
  visible,
  overview,
  isLoading,
  isSyncing,
  hasError,
  progress,
  onSync,
  onResolveConflict,
  onClose,
}: Readonly<CloudSaveModalProps>) {
  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();
  const snapshots = useMemo(
    () =>
      [...(overview?.snapshots ?? [])].sort((left, right) => {
        if (left.status === right.status) return 0;
        return left.status === "active" ? -1 : 1;
      }),
    [overview?.snapshots]
  );
  const progressLabel = progress
    ? t(`cloud_save_v2_progress_${progress.stage}`)
    : null;
  const stateDescription = overview
    ? stateDescriptionKey[overview.state]
    : undefined;

  let syncAction: ReactNode;
  if (isSyncing) {
    syncAction = (
      <Button className="cloud-save-v2__sync-button" disabled>
        {t("cloud_save_v2_syncing")}
      </Button>
    );
  } else if (overview?.state === "conflict") {
    syncAction = (
      <div className="cloud-save-v2__conflict-actions">
        <Button
          theme="outline"
          onClick={() => onResolveConflict("keep-local")}
          disabled={isLoading}
        >
          {t("cloud_save_v2_keep_local")}
        </Button>
        <Button
          theme="outline"
          onClick={() => onResolveConflict("keep-remote")}
          disabled={isLoading}
        >
          {t("cloud_save_v2_keep_remote")}
        </Button>
      </div>
    );
  } else {
    syncAction = (
      <Button onClick={onSync} disabled={isLoading}>
        {t("cloud_save_v2_sync_now")}
      </Button>
    );
  }

  return (
    <Modal
      visible={visible}
      title={t("cloud_save_v2_modal_title")}
      description={t("cloud_save_v2_modal_description")}
      onClose={onClose}
    >
      <div className="cloud-save-v2__modal">
        <div className="cloud-save-v2__summary">
          <span>{t("cloud_save_v2_status")}</span>
          <strong>
            {overview
              ? t(stateKey[overview.state])
              : t("cloud_save_v2_checking")}
          </strong>
        </div>

        {stateDescription && (
          <p className="cloud-save-v2__state-description">
            {t(stateDescription)}
          </p>
        )}

        {progress && progressLabel && (
          <div className="cloud-save-v2__progress">
            {isSyncing && <SyncIcon className="cloud-save-v2__spinner" />}
            <span>{progressLabel}</span>
            {progress.totalFiles > 0 && (
              <span>
                {progress.processedFiles}/{progress.totalFiles}
              </span>
            )}
          </div>
        )}

        {hasError && (
          <p className="cloud-save-v2__error">{t("cloud_save_v2_error")}</p>
        )}

        {syncAction}

        <section className="cloud-save-v2__snapshots">
          <h3>{t("cloud_save_v2_snapshots")}</h3>
          {!isLoading && snapshots.length === 0 && (
            <p className="cloud-save-v2__empty">
              {t("cloud_save_v2_no_snapshots")}
            </p>
          )}
          {snapshots.map((snapshot) => (
            <article className="cloud-save-v2__snapshot" key={snapshot.id}>
              <div>
                <strong>
                  {snapshot.status === "active"
                    ? t("cloud_save_v2_active_snapshot")
                    : t("cloud_save_v2_historical_snapshot")}
                </strong>
                <small>{formatDateTime(snapshot.createdAt)}</small>
              </div>
              <span>
                {t("cloud_save_v2_file_count", {
                  count: snapshot.fileCount,
                })}
                {" · "}
                {formatBytes(snapshot.totalSizeBytes)}
              </span>
            </article>
          ))}
        </section>
      </div>
    </Modal>
  );
}
