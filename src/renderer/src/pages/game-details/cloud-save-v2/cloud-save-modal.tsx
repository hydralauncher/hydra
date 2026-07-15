import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import {
  CaretDownIcon,
  CircleNotchIcon,
  ClockIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudIcon,
} from "@phosphor-icons/react";
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
  isAutomaticSyncEnabled: boolean;
  hasError: boolean;
  progress: CloudSaveSyncProgressPayload | null;
  onSync: () => void;
  onAutomaticSyncChange: (enabled: boolean) => Promise<void>;
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

const statusTone: Record<
  CloudSaveState,
  "synced" | "outdated" | "conflict" | "neutral"
> = {
  synced: "synced",
  "local-ahead": "outdated",
  "remote-ahead": "outdated",
  conflict: "conflict",
  untracked: "neutral",
};

const MAX_VISIBLE_HISTORICAL_SNAPSHOTS = 3;

export function CloudSaveModal({
  visible,
  overview,
  isLoading,
  isSyncing,
  isAutomaticSyncEnabled,
  hasError,
  progress,
  onSync,
  onAutomaticSyncChange,
  onResolveConflict,
  onClose,
}: Readonly<CloudSaveModalProps>) {
  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();
  const historyId = useId();
  const [isCloudSaveEnabled, setIsCloudSaveEnabled] = useState(
    isAutomaticSyncEnabled
  );
  const [isUpdatingAutomaticSync, setIsUpdatingAutomaticSync] = useState(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);
  const cloudSaveToggleTitle = t("cloud_save_v2_toggle_title", {
    status: t(
      isCloudSaveEnabled
        ? "cloud_save_v2_toggle_enabled"
        : "cloud_save_v2_toggle_disabled"
    ),
  });
  const { activeSnapshot, historicalSnapshots, historicalSnapshotCount } =
    useMemo(() => {
      const snapshots = overview?.snapshots ?? [];
      const historical = snapshots
        .filter((snapshot) => snapshot.status === "historical")
        .sort(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt)
        );

      return {
        activeSnapshot: snapshots.find(
          (snapshot) => snapshot.status === "active"
        ),
        historicalSnapshots: historical.slice(
          0,
          MAX_VISIBLE_HISTORICAL_SNAPSHOTS
        ),
        historicalSnapshotCount: historical.length,
      };
    }, [overview?.snapshots]);

  useEffect(() => {
    if (!visible) setIsHistoryExpanded(false);
  }, [visible]);

  useEffect(() => {
    setIsCloudSaveEnabled(isAutomaticSyncEnabled);
  }, [isAutomaticSyncEnabled]);

  const handleAutomaticSyncChange = async () => {
    const previousValue = isCloudSaveEnabled;
    const nextValue = !previousValue;

    setIsCloudSaveEnabled(nextValue);
    setIsUpdatingAutomaticSync(true);
    try {
      await onAutomaticSyncChange(nextValue);
    } catch {
      setIsCloudSaveEnabled(previousValue);
    } finally {
      setIsUpdatingAutomaticSync(false);
    }
  };

  const progressLabel = progress
    ? t(`cloud_save_v2_progress_${progress.stage}`)
    : null;
  const currentStatusTone = overview ? statusTone[overview.state] : "neutral";
  const snapshotMetadata = (
    createdAt: string,
    fileCount: number,
    totalSizeBytes: number
  ) => (
    <div className="cloud-save-v2__snapshot-metadata">
      <span>{formatDateTime(createdAt)}</span>
      <div className="cloud-save-v2__snapshot-stats">
        <span>
          {t("cloud_save_v2_file_count", {
            count: fileCount,
          })}
        </span>
        <span aria-hidden="true">·</span>
        <span>{formatBytes(totalSizeBytes)}</span>
      </div>
    </div>
  );

  let syncButtonIcon: ReactNode = <CloudIcon size={20} />;
  let syncButtonLabel = t("cloud_save_v2_sync_now");
  if (overview?.state === "local-ahead") {
    syncButtonIcon = <CloudArrowUpIcon size={20} />;
    syncButtonLabel = t("cloud_save_v2_sync_to_remote");
  } else if (overview?.state === "remote-ahead") {
    syncButtonIcon = <CloudArrowDownIcon size={20} />;
    syncButtonLabel = t("cloud_save_v2_sync_from_remote");
  }

  const syncingIcon: ReactNode = (
    <CircleNotchIcon className="cloud-save-v2__spinner" size={20} />
  );

  const progressFileCount =
    progress && progress.totalFiles > 0
      ? t("cloud_save_v2_progress_file_count", {
          count: progress.totalFiles,
          processed: progress.processedFiles,
          total: progress.totalFiles,
        })
      : null;

  let syncAction: ReactNode;
  if (isSyncing) {
    syncAction = (
      <Button className="cloud-save-v2__sync-button" disabled>
        {syncingIcon}
        <span>{progressLabel ?? t("cloud_save_v2_syncing")}</span>
        {progressFileCount && (
          <span className="cloud-save-v2__sync-file-count">
            · {progressFileCount}
          </span>
        )}
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
          <CloudArrowUpIcon size={20} />
          {t("cloud_save_v2_keep_local")}
        </Button>
        <Button
          theme="outline"
          onClick={() => onResolveConflict("keep-remote")}
          disabled={isLoading}
        >
          <CloudArrowDownIcon size={20} />
          {t("cloud_save_v2_keep_remote")}
        </Button>
      </div>
    );
  } else {
    syncAction = (
      <Button
        className="cloud-save-v2__sync-button"
        onClick={onSync}
        disabled={isLoading}
      >
        {syncButtonIcon}
        <span>{syncButtonLabel}</span>
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
        <div className="cloud-save-v2__toggle-row">
          <div className="cloud-save-v2__toggle-copy">
            <strong>{cloudSaveToggleTitle}</strong>
            <span>{t("cloud_save_v2_toggle_description")}</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isCloudSaveEnabled}
            aria-label={cloudSaveToggleTitle}
            disabled={isUpdatingAutomaticSync}
            className={`cloud-save-v2__switch ${isCloudSaveEnabled ? "cloud-save-v2__switch--enabled" : ""}`}
            onClick={() => void handleAutomaticSyncChange()}
          >
            <span className="cloud-save-v2__switch-thumb" />
          </button>
        </div>

        <section className="cloud-save-v2__active-snapshot">
          <article className="cloud-save-v2__snapshot cloud-save-v2__snapshot--active">
            {activeSnapshot ? (
              <>
                <div className="cloud-save-v2__snapshot-header">
                  <strong>{t("cloud_save_v2_active_snapshot")}</strong>
                  <span
                    className={`cloud-save-v2__status-pill cloud-save-v2__status-pill--${currentStatusTone}`}
                  >
                    {overview
                      ? t(stateKey[overview.state])
                      : t("cloud_save_v2_checking")}
                  </span>
                </div>
                {snapshotMetadata(
                  activeSnapshot.createdAt,
                  activeSnapshot.fileCount,
                  activeSnapshot.totalSizeBytes
                )}
              </>
            ) : (
              !isLoading && (
                <div className="cloud-save-v2__empty cloud-save-v2__empty--inline">
                  {t("cloud_save_v2_no_snapshots")}
                </div>
              )
            )}

            <div className="cloud-save-v2__action-area">
              {hasError && (
                <p className="cloud-save-v2__error">
                  {t("cloud_save_v2_error")}
                </p>
              )}

              {syncAction}
            </div>
          </article>
        </section>

        {historicalSnapshotCount > 0 && (
          <section className="cloud-save-v2__history">
            <button
              type="button"
              className="cloud-save-v2__history-toggle"
              aria-controls={historyId}
              aria-expanded={isHistoryExpanded}
              onClick={() => setIsHistoryExpanded((expanded) => !expanded)}
            >
              <span className="cloud-save-v2__history-title">
                <ClockIcon size={18} />
                {t("cloud_save_v2_history")}
              </span>
              <span className="cloud-save-v2__history-summary">
                <CaretDownIcon
                  size={16}
                  className={`cloud-save-v2__history-caret ${isHistoryExpanded ? "cloud-save-v2__history-caret--expanded" : ""}`}
                />
              </span>
            </button>

            <div
              id={historyId}
              className={`cloud-save-v2__history-content ${isHistoryExpanded ? "cloud-save-v2__history-content--expanded" : ""}`}
            >
              <div className="cloud-save-v2__history-list">
                {historicalSnapshots.map((snapshot) => (
                  <article
                    className="cloud-save-v2__snapshot cloud-save-v2__snapshot--historical"
                    key={snapshot.id}
                  >
                    <strong>{t("cloud_save_v2_historical_snapshot")}</strong>
                    {snapshotMetadata(
                      snapshot.createdAt,
                      snapshot.fileCount,
                      snapshot.totalSizeBytes
                    )}
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
