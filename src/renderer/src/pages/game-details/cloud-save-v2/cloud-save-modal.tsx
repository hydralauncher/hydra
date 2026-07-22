import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import {
  CaretDownIcon,
  CircleNotchIcon,
  ClockIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudIcon,
  FolderOpenIcon,
  WarningCircleIcon,
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

export interface CloudSavePanelProps {
  active?: boolean;
  showLaunchConflictWarning: boolean;
  overview: CloudSaveOverview | null;
  isLoading: boolean;
  isSyncing: boolean;
  isGameRunning: boolean;
  hasExecutablePath: boolean;
  isAutomaticSyncEnabled: boolean;
  hasError: boolean;
  progress: CloudSaveSyncProgressPayload | null;
  onSync: () => void;
  onOpenFileBrowser: () => void;
  onSelectExecutable: () => void;
  onAutomaticSyncChange: (enabled: boolean) => Promise<void>;
  onResolveConflict: (resolution: CloudSaveConflictResolution) => void;
}

interface CloudSaveModalProps extends Omit<CloudSavePanelProps, "active"> {
  visible: boolean;
  onClose: () => void;
}

const stateKey: Record<CloudSaveState, string> = {
  synced: "cloud_save_v2_synced",
  "local-ahead": "cloud_save_v2_outdated",
  "remote-ahead": "cloud_save_v2_outdated",
  conflict: "cloud_save_v2_conflict",
  untracked: "cloud_save",
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

export function CloudSavePanel({
  active = true,
  showLaunchConflictWarning,
  overview,
  isLoading,
  isSyncing,
  isGameRunning,
  hasExecutablePath,
  isAutomaticSyncEnabled,
  hasError,
  progress,
  onSync,
  onOpenFileBrowser,
  onSelectExecutable,
  onAutomaticSyncChange,
  onResolveConflict,
}: Readonly<CloudSavePanelProps>) {
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
    if (!active) setIsHistoryExpanded(false);
  }, [active]);

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
    totalSizeBytes: number,
    interactive = false
  ) => {
    const stats = (
      <>
        <span>
          {t("cloud_save_v2_file_count", {
            count: fileCount,
          })}
        </span>
        <span aria-hidden="true">·</span>
        <span>{formatBytes(totalSizeBytes)}</span>
      </>
    );

    return (
      <div className="cloud-save-v2__snapshot-metadata">
        <span>{formatDateTime(createdAt)}</span>
        {interactive ? (
          <button
            type="button"
            className="cloud-save-v2__snapshot-stats cloud-save-v2__snapshot-stats--interactive"
            onClick={onOpenFileBrowser}
            disabled={isLoading || isSyncing}
            aria-label={t(
              overview?.state === "conflict"
                ? "cloud_save_v2_view_conflicts"
                : "cloud_save_v2_view_files"
            )}
          >
            {overview?.state === "conflict"
              ? t("cloud_save_v2_view_conflicts")
              : stats}
          </button>
        ) : (
          <div className="cloud-save-v2__snapshot-stats">{stats}</div>
        )}
      </div>
    );
  };

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
          onClick={() => onResolveConflict("keep-local")}
          disabled={isLoading || isGameRunning}
        >
          <CloudArrowUpIcon size={20} />
          {t("cloud_save_v2_keep_local")}
        </Button>
        <Button
          onClick={() => onResolveConflict("keep-remote")}
          disabled={isLoading || isGameRunning}
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
        disabled={isLoading || isGameRunning}
      >
        {syncButtonIcon}
        <span>{syncButtonLabel}</span>
      </Button>
    );
  }

  const missingExecutableCard = (
    <section className="cloud-save-v2__snapshot cloud-save-v2__missing-executable">
      <div className="cloud-save-v2__missing-executable-copy">
        <strong>
          <WarningCircleIcon size={18} />
          {t("cloud_save_v2_executable_required_title")}
        </strong>
        <span>{t("cloud_save_v2_executable_required_description")}</span>
      </div>
      <Button
        className="cloud-save-v2__sync-button"
        onClick={onSelectExecutable}
      >
        <FolderOpenIcon size={20} />
        <span>{t("cloud_save_v2_select_executable")}</span>
      </Button>
    </section>
  );

  return (
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

      {showLaunchConflictWarning && overview?.state === "conflict" && (
        <p className="cloud-save-v2__launch-conflict-warning">
          {t("cloud_save_v2_resolve_before_launch")}
        </p>
      )}

      {isGameRunning && (
        <p className="cloud-save-v2__game-running-warning">
          {t("cloud_save_v2_close_game_before_manual_sync")}
        </p>
      )}

      {!hasExecutablePath ? (
        missingExecutableCard
      ) : (
        <>
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
                    activeSnapshot.totalSizeBytes,
                    true
                  )}
                </>
              ) : (
                !isLoading && (
                  <div className="cloud-save-v2__empty cloud-save-v2__empty--inline">
                    <button
                      type="button"
                      className="cloud-save-v2__empty-files-link"
                      onClick={onOpenFileBrowser}
                      disabled={isSyncing}
                      aria-label={t("cloud_save_v2_view_files")}
                    >
                      {t("cloud_save_v2_no_snapshots")}
                    </button>
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
        </>
      )}
    </div>
  );
}

export function CloudSaveModal({
  visible,
  onClose,
  ...panelProps
}: Readonly<CloudSaveModalProps>) {
  const { t } = useTranslation("game_details");

  return (
    <Modal
      visible={visible}
      title={t("cloud_save_v2_modal_title")}
      description={t("cloud_save_v2_modal_description")}
      onClose={onClose}
    >
      <CloudSavePanel {...panelProps} active={visible} />
    </Modal>
  );
}
