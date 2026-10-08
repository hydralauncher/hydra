import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowClockwiseIcon,
  CircleNotchIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudIcon,
  FolderOpenIcon,
  MonitorIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import type {
  CloudSaveConflictResolution,
  CloudSaveOverview,
  CloudSaveSyncProgressPayload,
  Rpcs3DiscIdentityStatus,
} from "@types";
import { formatBytes } from "@shared";
import { Button, Modal } from "@renderer/components";
import { useDate } from "@renderer/hooks";
import {
  getCloudSavePanelMode,
  getRpcs3ConfigWarningKey,
  shouldShowRpcs3IdentityCard,
  type Rpcs3ConfigCheckStatus,
} from "./rpcs3-config-presentation";
import type { RetroArchExecutableStatus } from "./retroarch-executable-status";
import {
  getCloudSavePanelAction,
  getCloudSaveOperationPresentation,
  getCloudSavePartialDescriptionKey,
  getCloudSavePresentation,
  getCloudSaveSnapshotPanelMode,
  type CloudSavePanelAction,
  shouldShowCloudSaveEmptySnapshot,
} from "./cloud-save-presentation";

export interface CloudSavePanelProps {
  active?: boolean;
  showLaunchConflictWarning: boolean;
  overview: CloudSaveOverview | null;
  isLoading: boolean;
  isSyncing: boolean;
  isGameRunning: boolean;
  hasExecutablePath: boolean;
  requiresRom: boolean;
  requiresDisc: boolean;
  retroArchExecutableStatus?: RetroArchExecutableStatus | null;
  onRetryRetroArchExecutable: () => void;
  onConfigureRetroArch: () => void;
  isAutomaticSyncEnabled: boolean | null;
  hasError: boolean;
  rpcs3ConfigStatus?: Rpcs3ConfigCheckStatus | null;
  onRetryRpcs3Config: () => void;
  rpcs3DiscStatus?: Rpcs3DiscIdentityStatus | null;
  rpcs3IdentityError?: boolean;
  onRetryRpcs3Disc: () => void;
  onConfigureRpcs3: () => void;
  errorMessageKey:
    | "cloud_save_v2_load_error"
    | "cloud_save_v2_sync_error"
    | null;
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

function CloudSaveSnapshotSkeleton({ label }: Readonly<{ label: string }>) {
  return (
    <section
      className="cloud-save-v2__active-snapshot"
      aria-busy="true"
      aria-label={label}
    >
      <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
        <article className="cloud-save-v2__snapshot cloud-save-v2__snapshot--active cloud-save-v2__snapshot--skeleton">
          <div className="cloud-save-v2__snapshot-header">
            <Skeleton width={120} height={16} />
            <Skeleton width={82} height={22} borderRadius={999} />
          </div>
          <div className="cloud-save-v2__snapshot-metadata">
            <Skeleton width={112} height={14} />
            <Skeleton width={128} height={14} />
          </div>
          <div className="cloud-save-v2__action-area cloud-save-v2__action-area--with-snapshot">
            <Skeleton height={40} borderRadius={4} />
          </div>
        </article>
      </SkeletonTheme>
    </section>
  );
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
    const operation = getCloudSaveOperationPresentation(progress);
    const progressFileCount = operation.fileCount
      ? t("cloud_save_v2_progress_file_count", operation.fileCount)
      : null;

    return (
      <Button className="cloud-save-v2__sync-button" disabled>
        <CircleNotchIcon className="cloud-save-v2__spinner" size={20} />
        <span>{t(operation.labelKey)}</span>
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
    case "confirm-location":
      return (
        <Button
          className="cloud-save-v2__sync-button"
          onClick={onSync}
          disabled={isLoading || isGameRunning}
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
  requiresRom,
  requiresDisc,
  retroArchExecutableStatus,
  onRetryRetroArchExecutable,
  onConfigureRetroArch,
  isAutomaticSyncEnabled,
  hasError,
  rpcs3ConfigStatus,
  onRetryRpcs3Config,
  rpcs3DiscStatus,
  rpcs3IdentityError = false,
  onRetryRpcs3Disc,
  onConfigureRpcs3,
  errorMessageKey,
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
  const showEmptySnapshot = shouldShowCloudSaveEmptySnapshot({
    overview,
    isLoading,
    hasError,
  });
  const hasSnapshotSummary = activeSnapshot !== null || showEmptySnapshot;
  const hasUnconfiguredCustomPaths =
    (overview?.unconfiguredCustomPathCount ?? 0) > 0;
  const presentation = getCloudSavePresentation({
    canUseCloudSaves: true,
    hasExecutablePath,
    isChecking: isLoading && !overview,
    isSyncing,
    hasError,
    hasUnconfiguredCustomPaths,
    state: overview?.state ?? null,
    progressStage: isSyncing ? (progress?.stage ?? null) : null,
  });
  const panelAction = getCloudSavePanelAction(
    overview?.state ?? null,
    overview?.suggestedAction ?? null,
    hasUnconfiguredCustomPaths
  );
  const snapshotPanelMode = getCloudSaveSnapshotPanelMode({
    overview,
    isLoading,
    isSyncing,
    hasError,
  });
  const partialDescriptionKey = getCloudSavePartialDescriptionKey(overview);
  const rpcs3WarningKey = getRpcs3ConfigWarningKey(rpcs3ConfigStatus);
  const retroArchNeedsConfig =
    retroArchExecutableStatus !== null &&
    retroArchExecutableStatus !== undefined &&
    retroArchExecutableStatus !== "ready";
  const basePanelMode = getCloudSavePanelMode(
    hasExecutablePath,
    rpcs3ConfigStatus,
    snapshotPanelMode,
    isSyncing,
    retroArchExecutableStatus
  );
  const identityBlocked =
    shouldShowRpcs3IdentityCard(
      requiresDisc,
      rpcs3DiscStatus,
      rpcs3IdentityError,
      isSyncing
    ) &&
    hasExecutablePath &&
    rpcs3ConfigStatus === "ready";
  const panelMode = identityBlocked ? "rpcs3-identity" : basePanelMode;

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
    fileCount: number,
    totalSizeBytes: number,
    interactive = false
  ) => {
    const isConflict = overview?.state === "conflict";
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
    const snapshotVersion = (
      icon: React.ReactNode,
      updatedAt: string | null,
      sizeBytes: number
    ) => (
      <span className="cloud-save-v2__snapshot-version">
        {icon}
        {updatedAt && <span>{formatDateTime(updatedAt)}</span>}
        <span aria-hidden="true">{"\u00b7"}</span>
        <span>{formatBytes(sizeBytes)}</span>
      </span>
    );

    return (
      <div className="cloud-save-v2__snapshot-metadata">
        {isConflict ? (
          <div className="cloud-save-v2__snapshot-versions">
            {snapshotVersion(
              <MonitorIcon size={14} aria-label={t("cloud_save_v2_local")} />,
              overview.localSnapshotSummary.updatedAt,
              overview.localSnapshotSummary.totalSizeBytes
            )}
            {snapshotVersion(
              <CloudIcon size={14} aria-label={t("cloud_save_v2_remote")} />,
              updatedAt,
              totalSizeBytes
            )}
          </div>
        ) : (
          <span>{formatDateTime(updatedAt)}</span>
        )}
        {interactive ? (
          <button
            type="button"
            className="cloud-save-v2__snapshot-stats cloud-save-v2__snapshot-stats--interactive"
            onClick={onOpenFileBrowser}
            disabled={isLoading || isSyncing}
            aria-label={t(
              isConflict
                ? "cloud_save_v2_view_conflicts"
                : "cloud_save_v2_view_files"
            )}
          >
            {isConflict ? t("cloud_save_v2_view_conflicts") : stats}
          </button>
        ) : (
          <div className="cloud-save-v2__snapshot-stats">{stats}</div>
        )}
      </div>
    );
  };

  let snapshotSummary: ReactNode = null;
  if (activeSnapshot) {
    snapshotSummary = (
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
          activeSnapshot.fileCount,
          activeSnapshot.totalSizeBytes,
          true
        )}
      </>
    );
  } else if (showEmptySnapshot) {
    snapshotSummary = (
      <>
        <div className="cloud-save-v2__snapshot-header">
          <strong>{t("cloud_save_v2_cloud_saves")}</strong>
          <span className="cloud-save-v2__status-pill">
            {t("cloud_save_v2_not_created")}
          </span>
        </div>
        <div className="cloud-save-v2__snapshot-metadata">
          <span>{t("cloud_save_v2_no_cloud_saves_description")}</span>
          <button
            type="button"
            className="cloud-save-v2__snapshot-stats cloud-save-v2__snapshot-stats--interactive"
            onClick={onOpenFileBrowser}
            disabled={isLoading || isSyncing}
          >
            {t("cloud_save_v2_manage_save_locations")}
          </button>
        </div>
      </>
    );
  }

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
          {t(
            requiresDisc
              ? "cloud_save_v2_disc_required_title"
              : requiresRom
                ? "cloud_save_v2_rom_required_title"
                : "cloud_save_v2_executable_required_title"
          )}
        </strong>
        <span>
          {t(
            requiresDisc
              ? "cloud_save_v2_disc_required_description"
              : requiresRom
                ? "cloud_save_v2_rom_required_description"
                : "cloud_save_v2_executable_required_description"
          )}
        </span>
      </div>
      <Button
        className="cloud-save-v2__sync-button"
        onClick={onSelectExecutable}
      >
        <FolderOpenIcon size={20} />
        <span>
          {t(
            requiresDisc
              ? "cloud_save_v2_select_disc"
              : requiresRom
                ? "cloud_save_v2_select_rom"
                : "cloud_save_v2_select_executable"
          )}
        </span>
      </Button>
    </section>
  );

  const rpcs3ConfigCard = rpcs3WarningKey && (
    <section className="cloud-save-v2__snapshot cloud-save-v2__required-setup">
      <div className="cloud-save-v2__required-setup-copy">
        <strong>
          <WarningCircleIcon size={18} />
          {t("cloud_save_v2_rpcs3_config_required_title")}
        </strong>
        <span>{t(rpcs3WarningKey)}</span>
      </div>
      <Button
        className="cloud-save-v2__sync-button"
        onClick={
          rpcs3ConfigStatus === "error" ? onRetryRpcs3Config : onConfigureRpcs3
        }
      >
        {rpcs3ConfigStatus === "error" ? (
          <ArrowClockwiseIcon size={20} />
        ) : (
          <FolderOpenIcon size={20} />
        )}
        <span>
          {t(
            rpcs3ConfigStatus === "error"
              ? "cloud_save_v2_check_again"
              : "cloud_save_v2_rpcs3_config_open_settings"
          )}
        </span>
      </Button>
    </section>
  );
  const retroArchConfigCard = (
    <section className="cloud-save-v2__snapshot cloud-save-v2__required-setup">
      <div className="cloud-save-v2__required-setup-copy">
        <strong>
          <WarningCircleIcon size={18} />
          {t("cloud_save_v2_retroarch_config_required_title")}
        </strong>
        <span>
          {t(
            retroArchExecutableStatus === "invalid"
              ? "cloud_save_v2_retroarch_config_invalid"
              : retroArchExecutableStatus === "error"
                ? "cloud_save_v2_retroarch_config_error"
                : "cloud_save_v2_retroarch_config_missing"
          )}
        </span>
      </div>
      <Button
        className="cloud-save-v2__sync-button"
        onClick={
          retroArchExecutableStatus === "error"
            ? onRetryRetroArchExecutable
            : onConfigureRetroArch
        }
      >
        {retroArchExecutableStatus === "error" ? (
          <ArrowClockwiseIcon size={20} />
        ) : (
          <FolderOpenIcon size={20} />
        )}
        <span>
          {t(
            retroArchExecutableStatus === "error"
              ? "cloud_save_v2_check_again"
              : "cloud_save_v2_retroarch_config_open_settings"
          )}
        </span>
      </Button>
    </section>
  );
  const rpcs3IdentityCard = (
    <section className="cloud-save-v2__snapshot cloud-save-v2__required-setup">
      <div className="cloud-save-v2__required-setup-copy">
        <strong>
          <WarningCircleIcon size={18} />
          {t("cloud_save_v2_rpcs3_identity_title")}
        </strong>
        <span>
          {t(
            rpcs3IdentityError
              ? "cloud_save_v2_rpcs3_identity_remote"
              : `cloud_save_v2_rpcs3_identity_${rpcs3DiscStatus?.status ?? "unverified"}`,
            { path: rpcs3DiscStatus?.path, titleId: rpcs3DiscStatus?.titleId }
          )}
        </span>
      </div>
      {!rpcs3IdentityError && (
        <Button
          className="cloud-save-v2__sync-button"
          onClick={
            rpcs3DiscStatus?.status === "catalogue-unavailable"
              ? onRetryRpcs3Disc
              : onSelectExecutable
          }
        >
          <FolderOpenIcon size={20} />
          <span>
            {t(
              rpcs3DiscStatus?.status === "catalogue-unavailable"
                ? "cloud_save_v2_check_again"
                : "cloud_save_v2_rpcs3_identity_edit_discs"
            )}
          </span>
        </Button>
      )}
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
            (retroArchNeedsConfig && !isCloudSaveEnabled) ||
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

      {errorMessageKey && (
        <p className="cloud-save-v2__error">{t(errorMessageKey)}</p>
      )}

      {panelMode === "content" && hasUnconfiguredCustomPaths && !hasError && (
        <p className="cloud-save-v2__error">
          {t("cloud_save_v2_unconfigured_custom_path_description")}
        </p>
      )}

      {panelMode === "content" && partialDescriptionKey && !hasError && (
        <p className="cloud-save-v2__partial-warning">
          {t(partialDescriptionKey)}
        </p>
      )}

      {panelMode === "missing-executable" && missingExecutableCard}

      {panelMode === "rpcs3-config" && rpcs3ConfigCard}
      {panelMode === "retroarch-config" && retroArchConfigCard}
      {panelMode === "rpcs3-identity" && rpcs3IdentityCard}

      {panelMode === "skeleton" && (
        <CloudSaveSnapshotSkeleton label={t("cloud_save_v2_checking")} />
      )}

      {panelMode === "content" && (
        <section className="cloud-save-v2__active-snapshot">
          <article className="cloud-save-v2__snapshot cloud-save-v2__snapshot--active">
            {snapshotSummary}

            <div
              className={`cloud-save-v2__action-area ${
                hasSnapshotSummary
                  ? "cloud-save-v2__action-area--with-snapshot"
                  : ""
              }`}
            >
              {syncAction}
            </div>
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
      className="cloud-save-v2__dialog"
      visible={visible}
      title={t("cloud_save_v2_modal_title")}
      description={t("cloud_save_v2_modal_description")}
      onClose={onClose}
    >
      <div className="cloud-save-v2__dialog-content">
        <CloudSavePanel {...panelProps} active={visible} />
      </div>
    </Modal>
  );
}
