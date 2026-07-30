import {
  ArrowClockwiseIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudCheckIcon,
  CloudIcon,
  FolderOpenIcon,
  SpinnerIcon,
  ToggleLeftIcon,
  ToggleRightIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  getCloudSavePanelAction,
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
const TOGGLE_BUTTON_ID = "big-picture-cloud-save-toggle";
const PRIMARY_ACTION_ID = "big-picture-cloud-save-primary-action";
const KEEP_LOCAL_ID = "big-picture-cloud-save-keep-local";
const USE_CLOUD_ID = "big-picture-cloud-save-use-cloud";

interface BigPictureCloudSaveModalProps {
  visible: boolean;
  showLaunchConflictWarning: boolean;
  overview: CloudSaveOverview | null;
  isLoading: boolean;
  isSyncing: boolean;
  isGameRunning: boolean;
  hasExecutablePath: boolean;
  hasError: boolean;
  progress: CloudSaveSyncProgressPayload | null;
  onClose: () => void;
  onSync: () => void;
  onSelectExecutable: () => void;
  onAutomaticSyncChange: (enabled: boolean) => Promise<void>;
  onResolveConflict: (resolution: CloudSaveConflictResolution) => void;
}

function getActionIcon(icon: string | undefined): ReactNode {
  switch (icon) {
    case "upload":
      return <CloudArrowUpIcon size={24} />;
    case "restore":
      return <CloudArrowDownIcon size={24} />;
    case "cloud":
      return <CloudIcon size={24} />;
    default:
      return <ArrowClockwiseIcon size={24} />;
  }
}

export function BigPictureCloudSaveModal({
  visible,
  showLaunchConflictWarning,
  overview,
  isLoading,
  isSyncing,
  isGameRunning,
  hasExecutablePath,
  hasError,
  progress,
  onClose,
  onSync,
  onSelectExecutable,
  onAutomaticSyncChange,
  onResolveConflict,
}: Readonly<BigPictureCloudSaveModalProps>) {
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
    state: overview?.state ?? null,
    progressStage: progress?.stage ?? null,
  });
  const derivedAction = getBigPictureCloudSaveAction(
    getCloudSavePanelAction(
      overview?.state ?? null,
      overview?.suggestedAction ?? null
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
    <Modal
      visible={visible}
      title={t("cloud_save_v2_modal_title")}
      description={t("cloud_save_v2_modal_description")}
      onClose={onClose}
      closeOnBackdrop={!isSyncing}
      closeOnEscape={!isSyncing}
      closeOnB={!isSyncing}
      initialFocusId={TOGGLE_BUTTON_ID}
      className="big-picture-cloud-save-modal"
    >
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
            focusId={TOGGLE_BUTTON_ID}
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
              <ToggleRightIcon size={30} weight="fill" />
            ) : (
              <ToggleLeftIcon size={30} />
            )}
          </Button>
        </section>

        {showLaunchConflictWarning && overview?.state === "conflict" ? (
          <p className="big-picture-cloud-save__notice big-picture-cloud-save__notice--warning">
            <WarningCircleIcon size={20} weight="fill" />
            {t("cloud_save_v2_resolve_before_launch")}
          </p>
        ) : null}

        {isGameRunning ? (
          <p className="big-picture-cloud-save__notice">
            {t("cloud_save_v2_close_game_before_manual_sync")}
          </p>
        ) : null}

        {hasError ? (
          <p className="big-picture-cloud-save__error">
            {t("cloud_save_v2_error")}
          </p>
        ) : null}

        <section className="big-picture-cloud-save__snapshot">
          {!hasExecutablePath ? (
            <div className="big-picture-cloud-save__missing-executable-copy">
              <strong>
                <WarningCircleIcon size={20} />
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
                <span>{formatDateTime(activeSnapshot.updatedAt)}</span>
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
                size={26}
                className="big-picture-cloud-save__spinner"
              />
              <span>{t("cloud_save_v2_checking")}</span>
            </div>
          )}

          {!hasExecutablePath ? (
            <Button
              focusId={PRIMARY_ACTION_ID}
              variant="primary"
              icon={<FolderOpenIcon size={22} />}
              stealFocusOnAppear
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
                icon={<CloudArrowUpIcon size={24} />}
                stealFocusOnAppear
                disabled={isLoading || isGameRunning}
                onClick={() => onResolveConflict("keep-local")}
              >
                {t("cloud_save_v2_keep_local")}
              </Button>
              <Button
                focusId={USE_CLOUD_ID}
                variant="primary"
                icon={<CloudArrowDownIcon size={24} />}
                disabled={isLoading || isGameRunning}
                onClick={() => onResolveConflict("keep-remote")}
              >
                {t("cloud_save_v2_keep_remote")}
              </Button>
            </HorizontalFocusGroup>
          ) : action.kind === "sync" ? (
            <Button
              focusId={PRIMARY_ACTION_ID}
              variant="primary"
              icon={getActionIcon(action.icon)}
              stealFocusOnAppear
              disabled={isLoading || isGameRunning}
              onClick={onSync}
            >
              {t(action.labelKey ?? "cloud_save_v2_check_again")}
            </Button>
          ) : (
            <div className="big-picture-cloud-save__synced">
              <CloudCheckIcon size={22} />
              <span>{t("cloud_save_v2_synced")}</span>
            </div>
          )}
        </section>
      </VerticalFocusGroup>
    </Modal>
  );
}
