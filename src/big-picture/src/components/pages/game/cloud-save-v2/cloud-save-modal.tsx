import {
  ArrowClockwiseIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudCheckIcon,
  CloudIcon,
  FolderOpenIcon,
  MonitorIcon,
  SpinnerIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  getCloudSavePanelAction,
  getCloudSavePartialDescriptionKey,
  getCloudSavePresentation,
  shouldShowCloudSaveEmptySnapshot,
} from "@renderer/pages/game-details/cloud-save-v2/cloud-save-presentation";
import { formatBytes } from "@shared";
import type {
  CloudSaveConflictResolution,
  CloudSaveOverview,
  CloudSaveSyncProgressPayload,
} from "@types";

import { useDate } from "../../../../hooks";
import {
  Button,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../../../common";
import { getBigPictureCloudSaveAction } from "./cloud-save-v2-presentation";

const GENERAL_REGION_ID = "big-picture-cloud-save-general";
export const BIG_PICTURE_CLOUD_SAVE_TOGGLE_BUTTON_ID =
  "big-picture-cloud-save-toggle";
const PRIMARY_ACTION_ID = "big-picture-cloud-save-primary-action";
const KEEP_LOCAL_ID = "big-picture-cloud-save-keep-local";
const USE_CLOUD_ID = "big-picture-cloud-save-use-cloud";
const TOGGLE_ICON_SIZE = 30;
const LOADING_ICON_SIZE = 26;
const CLOUD_ACTION_ICON_SIZE = 24;
const INLINE_STATUS_ICON_SIZE = 22;
const NOTICE_ICON_SIZE = 20;
const SNAPSHOT_METADATA_ICON_SIZE = 16;

export interface BigPictureCloudSavePanelProps {
  showLaunchConflictWarning: boolean;
  stealFocusOnActionAppear?: boolean;
  overview: CloudSaveOverview | null;
  isLoading: boolean;
  isSyncing: boolean;
  isGameRunning: boolean;
  hasExecutablePath: boolean;
  hasError: boolean;
  errorMessageKey:
    | "cloud_save_v2_load_error"
    | "cloud_save_v2_sync_error"
    | null;
  progress: CloudSaveSyncProgressPayload | null;
  onSync: () => void;
  onSelectExecutable: () => void;
  onAutomaticSyncChange: (enabled: boolean) => Promise<void>;
  onResolveConflict: (resolution: CloudSaveConflictResolution) => void;
}

interface BigPictureCloudSaveModalProps extends BigPictureCloudSavePanelProps {
  visible: boolean;
  onClose: () => void;
}

function getActionIcon(icon: string | undefined): ReactNode {
  switch (icon) {
    case "upload":
      return <CloudArrowUpIcon size={CLOUD_ACTION_ICON_SIZE} />;
    case "restore":
      return <CloudArrowDownIcon size={CLOUD_ACTION_ICON_SIZE} />;
    case "cloud":
      return <CloudIcon size={CLOUD_ACTION_ICON_SIZE} />;
    case "folder":
      return <FolderOpenIcon size={CLOUD_ACTION_ICON_SIZE} />;
    default:
      return <ArrowClockwiseIcon size={CLOUD_ACTION_ICON_SIZE} />;
  }
}

export function BigPictureCloudSavePanel({
  showLaunchConflictWarning,
  stealFocusOnActionAppear = false,
  overview,
  isLoading,
  isSyncing,
  isGameRunning,
  hasExecutablePath,
  hasError,
  errorMessageKey,
  progress,
  onSync,
  onSelectExecutable,
  onAutomaticSyncChange,
  onResolveConflict,
}: Readonly<BigPictureCloudSavePanelProps>) {
  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();
  const [isAutomaticSyncEnabled, setIsAutomaticSyncEnabled] = useState(
    overview?.isAutomaticSyncEnabled ?? false
  );
  const [isUpdatingAutomaticSync, setIsUpdatingAutomaticSync] = useState(false);

  useEffect(() => {
    setIsAutomaticSyncEnabled(overview?.isAutomaticSyncEnabled ?? false);
  }, [overview?.isAutomaticSyncEnabled]);

  const activeSnapshot = overview?.activeRemoteSnapshot ?? null;
  const hasUnconfiguredCustomPaths =
    (overview?.unconfiguredCustomPathCount ?? 0) > 0;
  const partialDescriptionKey = getCloudSavePartialDescriptionKey(overview);
  const showEmptySnapshot = shouldShowCloudSaveEmptySnapshot({
    overview,
    isLoading,
    hasError,
  });
  const presentation = getCloudSavePresentation({
    canUseCloudSaves: true,
    hasExecutablePath,
    isChecking: isLoading && overview === null,
    isSyncing,
    hasError,
    hasUnconfiguredCustomPaths,
    state: overview?.state ?? null,
    progressStage: progress?.stage ?? null,
  });
  const derivedAction = getBigPictureCloudSaveAction(
    getCloudSavePanelAction(
      overview?.state ?? null,
      overview?.suggestedAction ?? null,
      hasUnconfiguredCustomPaths
    )
  );
  const action =
    hasError && !isSyncing
      ? {
          kind: "sync" as const,
          labelKey: "cloud_save_v2_check_again",
          icon: "spinner" as const,
        }
      : derivedAction;
  const progressLabel = progress
    ? t(`cloud_save_v2_progress_${progress.stage}`)
    : t("cloud_save_v2_syncing");
  const snapshotVersion = (
    icon: ReactNode,
    updatedAt: string | null,
    sizeBytes: number
  ) => (
    <span className="big-picture-cloud-save__snapshot-version">
      {icon}
      {updatedAt && <span>{formatDateTime(updatedAt)}</span>}
      <span aria-hidden="true">{"\u00b7"}</span>
      <span>{formatBytes(sizeBytes)}</span>
    </span>
  );

  const handleAutomaticSyncChange = async () => {
    const previousValue = isAutomaticSyncEnabled;
    const nextValue = !previousValue;
    setIsAutomaticSyncEnabled(nextValue);
    setIsUpdatingAutomaticSync(true);

    try {
      await onAutomaticSyncChange(nextValue);
    } catch {
      setIsAutomaticSyncEnabled(previousValue);
    } finally {
      setIsUpdatingAutomaticSync(false);
    }
  };

  return (
    <VerticalFocusGroup
      regionId={GENERAL_REGION_ID}
      className="big-picture-cloud-save"
    >
      <section className="big-picture-cloud-save__toggle-card">
        <div className="big-picture-cloud-save__copy">
          <strong>
            {t("cloud_save_v2_toggle_title", {
              status: t(
                isAutomaticSyncEnabled
                  ? "cloud_save_v2_toggle_enabled"
                  : "cloud_save_v2_toggle_disabled"
              ),
            })}
          </strong>
          <span>{t("cloud_save_v2_toggle_description")}</span>
        </div>

        <Button
          focusId={BIG_PICTURE_CLOUD_SAVE_TOGGLE_BUTTON_ID}
          variant="secondary"
          size="icon"
          aria-label={t("cloud_save_v2_toggle_title", {
            status: t(
              isAutomaticSyncEnabled
                ? "cloud_save_v2_toggle_enabled"
                : "cloud_save_v2_toggle_disabled"
            ),
          })}
          disabled={
            isUpdatingAutomaticSync ||
            isSyncing ||
            !hasExecutablePath ||
            overview?.isAutomaticSyncEnabled == null
          }
          onClick={() => void handleAutomaticSyncChange()}
        >
          {isAutomaticSyncEnabled ? (
            <ToggleRightIcon size={TOGGLE_ICON_SIZE} weight="fill" />
          ) : (
            <ToggleLeftIcon size={TOGGLE_ICON_SIZE} />
          )}
        </Button>
      </section>

      {showLaunchConflictWarning && overview?.state === "conflict" ? (
        <p className="big-picture-cloud-save__notice big-picture-cloud-save__notice--warning">
          <WarningCircleIcon size={NOTICE_ICON_SIZE} weight="fill" />
          {t("cloud_save_v2_resolve_before_launch")}
        </p>
      ) : null}

      {isGameRunning ? (
        <p className="big-picture-cloud-save__notice">
          {t("cloud_save_v2_close_game_before_manual_sync")}
        </p>
      ) : null}

      {errorMessageKey ? (
        <p className="big-picture-cloud-save__error">{t(errorMessageKey)}</p>
      ) : null}

      {hasUnconfiguredCustomPaths && !hasError ? (
        <p className="big-picture-cloud-save__error">
          {t("cloud_save_v2_unconfigured_custom_path_description")}
        </p>
      ) : null}

      {partialDescriptionKey && !hasError ? (
        <p className="big-picture-cloud-save__notice big-picture-cloud-save__notice--warning">
          <WarningCircleIcon size={NOTICE_ICON_SIZE} weight="fill" />
          {t(partialDescriptionKey)}
        </p>
      ) : null}

      <section className="big-picture-cloud-save__snapshot">
        {!hasExecutablePath ? (
          <div className="big-picture-cloud-save__missing-executable-copy">
            <strong>
              <WarningCircleIcon size={NOTICE_ICON_SIZE} />
              {t("cloud_save_v2_executable_required_title")}
            </strong>
            <span>{t("cloud_save_v2_executable_required_description")}</span>
          </div>
        ) : activeSnapshot ? (
          <>
            <div className="big-picture-cloud-save__snapshot-header">
              <strong>{t("cloud_save_v2_active_snapshot")}</strong>
              <span
                className={`big-picture-cloud-save__pill big-picture-cloud-save__pill--${presentation.tone}`}
              >
                {t(presentation.labelKey)}
              </span>
            </div>
            <div className="big-picture-cloud-save__metadata">
              {overview?.state === "conflict" ? (
                <div className="big-picture-cloud-save__snapshot-versions">
                  {snapshotVersion(
                    <MonitorIcon
                      size={SNAPSHOT_METADATA_ICON_SIZE}
                      aria-label={t("cloud_save_v2_local")}
                    />,
                    overview.localSnapshotSummary.updatedAt,
                    overview.localSnapshotSummary.totalSizeBytes
                  )}
                  {snapshotVersion(
                    <CloudIcon
                      size={SNAPSHOT_METADATA_ICON_SIZE}
                      aria-label={t("cloud_save_v2_remote")}
                    />,
                    activeSnapshot.updatedAt,
                    activeSnapshot.totalSizeBytes
                  )}
                </div>
              ) : (
                <span>{formatDateTime(activeSnapshot.updatedAt)}</span>
              )}
              <span>
                {t("cloud_save_v2_file_count", {
                  count: activeSnapshot.fileCount,
                })}{" "}
                · {formatBytes(activeSnapshot.totalSizeBytes)}
              </span>
            </div>
          </>
        ) : showEmptySnapshot ? (
          <>
            <div className="big-picture-cloud-save__snapshot-header">
              <strong>{t("cloud_save_v2_cloud_saves")}</strong>
              <span className="big-picture-cloud-save__pill">
                {t("cloud_save_v2_not_created")}
              </span>
            </div>
            <p className="big-picture-cloud-save__empty-copy">
              {t("cloud_save_v2_no_cloud_saves_description")}
            </p>
          </>
        ) : (
          <div
            className="big-picture-cloud-save__snapshot-placeholder"
            aria-label={t("cloud_save_v2_checking")}
          >
            <SpinnerIcon
              size={LOADING_ICON_SIZE}
              className="big-picture-cloud-save__spinner"
            />
            <span>{t("cloud_save_v2_checking")}</span>
          </div>
        )}

        {!hasExecutablePath ? (
          <Button
            focusId={PRIMARY_ACTION_ID}
            variant="primary"
            icon={<FolderOpenIcon size={INLINE_STATUS_ICON_SIZE} />}
            stealFocusOnAppear={stealFocusOnActionAppear}
            onClick={onSelectExecutable}
          >
            {t("cloud_save_v2_select_executable")}
          </Button>
        ) : isSyncing ? (
          <Button
            focusId={PRIMARY_ACTION_ID}
            variant="primary"
            loading
            disabled
          >
            {progressLabel}
          </Button>
        ) : action.kind === "conflict" ? (
          <HorizontalFocusGroup className="big-picture-cloud-save__actions">
            <Button
              focusId={KEEP_LOCAL_ID}
              variant="primary"
              icon={<CloudArrowUpIcon size={CLOUD_ACTION_ICON_SIZE} />}
              stealFocusOnAppear={stealFocusOnActionAppear}
              disabled={isLoading || isGameRunning}
              onClick={() => onResolveConflict("keep-local")}
              focusNavigationOverrides={{
                right: {
                  type: "item",
                  itemId: USE_CLOUD_ID,
                },
              }}
            >
              {t("cloud_save_v2_keep_local")}
            </Button>
            <Button
              focusId={USE_CLOUD_ID}
              variant="primary"
              icon={<CloudArrowDownIcon size={CLOUD_ACTION_ICON_SIZE} />}
              disabled={isLoading || isGameRunning}
              onClick={() => onResolveConflict("keep-remote")}
              focusNavigationOverrides={{
                left: {
                  type: "item",
                  itemId: KEEP_LOCAL_ID,
                },
              }}
            >
              {t("cloud_save_v2_keep_remote")}
            </Button>
          </HorizontalFocusGroup>
        ) : action.kind === "sync" ? (
          <Button
            focusId={PRIMARY_ACTION_ID}
            variant="primary"
            icon={getActionIcon(action.icon)}
            stealFocusOnAppear={stealFocusOnActionAppear}
            disabled={isLoading || isGameRunning}
            onClick={onSync}
          >
            {t(action.labelKey ?? "cloud_save_v2_check_again")}
          </Button>
        ) : (
          <div className="big-picture-cloud-save__synced">
            <CloudCheckIcon size={INLINE_STATUS_ICON_SIZE} />
            <span>{t("cloud_save_v2_synced")}</span>
          </div>
        )}
      </section>
    </VerticalFocusGroup>
  );
}

export function BigPictureCloudSaveModal({
  visible,
  onClose,
  ...panelProps
}: Readonly<BigPictureCloudSaveModalProps>) {
  const { t } = useTranslation("game_details");

  return (
    <Modal
      visible={visible}
      title={t("cloud_save_v2_modal_title")}
      description={t("cloud_save_v2_modal_description")}
      onClose={onClose}
      closeOnBackdrop={!panelProps.isSyncing}
      closeOnEscape={!panelProps.isSyncing}
      closeOnB={!panelProps.isSyncing}
      initialFocusId={BIG_PICTURE_CLOUD_SAVE_TOGGLE_BUTTON_ID}
      className="big-picture-cloud-save-modal"
    >
      <BigPictureCloudSavePanel {...panelProps} stealFocusOnActionAppear />
    </Modal>
  );
}
