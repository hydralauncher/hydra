import { useEffect, useState } from "react";
import {
  ArrowClockwiseIcon,
  CircleNotchIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudIcon,
  FolderOpenIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

import type {
  CloudSaveConflictResolution,
  CloudSaveOverview,
  CloudSaveSyncProgressPayload,
} from "@types";
import { formatBytes } from "@shared";
import { Button, Modal } from "@renderer/components";
import { useDate } from "@renderer/hooks";
import {
  getCloudSavePanelAction,
  getCloudSavePresentation,
  isCloudSaveOverviewEmpty,
  type CloudSavePanelAction,
} from "./cloud-save-presentation";

export interface CloudSavePanelProps {
  active?: boolean;
  showLaunchConflictWarning: boolean;
  overview: CloudSaveOverview | null;
  isLoading: boolean;
  isSyncing: boolean;
  isGameRunning: boolean;
  hasExecutablePath: boolean;
  isAutomaticSyncEnabled: boolean | null;
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

interface CloudSaveSyncActionProps {
  action: CloudSavePanelAction;
  isLoading: boolean;
  isSyncing: boolean;
  isGameRunning: boolean;
  progress: CloudSaveSyncProgressPayload | null;
  onSync: () => void;
  onOpenFileBrowser: () => void;
  onResolveConflict: (resolution: CloudSaveConflictResolution) => void;
}

const getSyncActionIcon = (
  icon: Extract<CloudSavePanelAction, { kind: "sync" }>["icon"]
) => {
  if (icon === "upload") return <CloudArrowUpIcon size={20} />;
  if (icon === "restore") return <CloudArrowDownIcon size={20} />;
  return <CloudIcon size={20} />;
};

function CloudSaveSyncAction({
  action,
  isLoading,
  isSyncing,
  isGameRunning,
  progress,
  onSync,
  onOpenFileBrowser,
  onResolveConflict,
}: Readonly<CloudSaveSyncActionProps>) {
  const { t } = useTranslation("game_details");

  if (isSyncing) {
    const progressLabel = progress
      ? t(`cloud_save_v2_progress_${progress.stage}`)
      : t("cloud_save_v2_syncing");
    const progressFileCount =
      progress && progress.totalFiles > 0
        ? t("cloud_save_v2_progress_file_count", {
            count: progress.totalFiles,
            processed: progress.processedFiles,
            total: progress.totalFiles,
          })
        : null;

    return (
      <Button className="cloud-save-v2__sync-button" disabled>
        <CircleNotchIcon className="cloud-save-v2__spinner" size={20} />
        <span>{progressLabel}</span>
        {progressFileCount && (
          <span className="cloud-save-v2__sync-file-count">
            · {progressFileCount}
          </span>
        )}
      </Button>
    );
  }

  switch (action.kind) {
    case "conflict":
      return (
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
    case "details":
      return (
        <Button
          className="cloud-save-v2__sync-button"
          onClick={onOpenFileBrowser}
          disabled={isLoading}
        >
          <FolderOpenIcon size={20} />
          <span>{t(action.labelKey)}</span>
        </Button>
      );
    case "verify":
      return (
        <Button
          className="cloud-save-v2__sync-button"
          onClick={onSync}
          disabled={isLoading || isGameRunning}
        >
          <ArrowClockwiseIcon size={20} />
          <span>{t(action.labelKey)}</span>
        </Button>
      );
    case "sync":
      return (
        <Button
          className="cloud-save-v2__sync-button"
          onClick={onSync}
          disabled={isLoading || isGameRunning}
        >
          {getSyncActionIcon(action.icon)}
          <span>{t(action.labelKey)}</span>
        </Button>
      );
    case "none":
      return null;
  }
}

export function CloudSavePanel({
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
  const [isCloudSaveEnabled, setIsCloudSaveEnabled] = useState(
    isAutomaticSyncEnabled ?? false
  );
  const [isUpdatingAutomaticSync, setIsUpdatingAutomaticSync] = useState(false);
  const cloudSaveToggleTitle = t("cloud_save_v2_toggle_title", {
    status: t(
      isCloudSaveEnabled
        ? "cloud_save_v2_toggle_enabled"
        : "cloud_save_v2_toggle_disabled"
    ),
  });
  const activeSnapshot = overview?.activeRemoteSnapshot ?? null;
  const presentation = getCloudSavePresentation({
    canUseCloudSaves: true,
    hasExecutablePath,
    isChecking: isLoading && !overview,
    isSyncing,
    hasError,
    state: overview?.state ?? null,
    progressStage: isSyncing ? (progress?.stage ?? null) : null,
  });
  const panelAction = getCloudSavePanelAction(
    overview?.state ?? null,
    overview?.suggestedAction ?? null
  );

  useEffect(() => {
    setIsCloudSaveEnabled(isAutomaticSyncEnabled ?? false);
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

  const snapshotMetadata = (
    updatedAt: string,
    version: number,
    fileCount: number,
    totalSizeBytes: number,
    interactive = false
  ) => {
    const stats = (
      <>
        <span>v{version}</span>
        <span aria-hidden="true">·</span>
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
        <span>{formatDateTime(updatedAt)}</span>
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

  const syncAction = (
    <CloudSaveSyncAction
      action={panelAction}
      isLoading={isLoading}
      isSyncing={isSyncing}
      isGameRunning={isGameRunning}
      progress={progress}
      onSync={onSync}
      onOpenFileBrowser={onOpenFileBrowser}
      onResolveConflict={onResolveConflict}
    />
  );

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
          disabled={
            isUpdatingAutomaticSync ||
            !hasExecutablePath ||
            isAutomaticSyncEnabled === null
          }
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

      {hasError && (
        <p className="cloud-save-v2__error">{t("cloud_save_v2_error")}</p>
      )}

      {!isLoading && isCloudSaveOverviewEmpty(overview) && (
        <button
          type="button"
          className="cloud-save-v2__empty-message cloud-save-v2__empty-files-link"
          onClick={onOpenFileBrowser}
          disabled={isSyncing}
          aria-label={t("cloud_save_v2_view_files")}
        >
          {t("cloud_save_v2_no_snapshots")}
        </button>
      )}

      {!hasExecutablePath ? (
        missingExecutableCard
      ) : (
        <section className="cloud-save-v2__active-snapshot">
          <article className="cloud-save-v2__snapshot cloud-save-v2__snapshot--active">
            {activeSnapshot ? (
              <>
                <div className="cloud-save-v2__snapshot-header">
                  <strong>{t("cloud_save_v2_active_snapshot")}</strong>
                  <span
                    className={`cloud-save-v2__status-pill cloud-save-v2__status-pill--${presentation.tone}`}
                  >
                    {t(presentation.labelKey)}
                  </span>
                </div>
                {snapshotMetadata(
                  activeSnapshot.updatedAt,
                  activeSnapshot.version,
                  activeSnapshot.fileCount,
                  activeSnapshot.totalSizeBytes,
                  true
                )}
              </>
            ) : null}

            <div className="cloud-save-v2__action-area">{syncAction}</div>
          </article>
        </section>
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
