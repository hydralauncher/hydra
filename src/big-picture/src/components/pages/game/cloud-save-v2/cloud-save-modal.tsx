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
import {
  getCloudSavePanelMode,
  getRpcs3ConfigWarningKey,
  shouldShowRpcs3IdentityCard,
  type Rpcs3ConfigCheckStatus,
} from "@renderer/pages/game-details/cloud-save-v2/rpcs3-config-presentation";
import type { RetroArchExecutableStatus } from "@renderer/pages/game-details/cloud-save-v2/retroarch-executable-status";
import { formatBytes } from "@shared";
import type {
  CloudSaveConflictResolution,
  CloudSaveOverview,
  CloudSaveSyncProgressPayload,
  CloudSaveV2FileDetails,
  Rpcs3DiscIdentityStatus,
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
  requiresRom: boolean;
  requiresDisc: boolean;
  retroArchExecutableStatus?: RetroArchExecutableStatus | null;
  onRetryRetroArchExecutable: () => void;
  onConfigureRetroArch: () => void;
  rpcs3ConfigStatus?: Rpcs3ConfigCheckStatus | null;
  onRetryRpcs3Config: () => void;
  onConfigureRpcs3: () => void;
  rpcs3DiscStatus?: Rpcs3DiscIdentityStatus | null;
  rpcs3IdentityError?: boolean;
  onRetryRpcs3Disc: () => void;
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
  rpcs3Profile?: CloudSaveV2FileDetails["rpcs3Profile"];
  onSelectRpcs3Profile?: (cloudProfileId: string) => void;
  isBindingRpcs3Profile?: boolean;
  emulatorDestinations?: CloudSaveV2FileDetails["emulatorDestinations"];
  onSelectEmulatorDestination?: (
    rawPath: string,
    kind: "save" | "state"
  ) => void;
  onRemoveEmulatorDestination?: (
    rawPath: string,
    kind: "save" | "state"
  ) => void;
  isBindingEmulatorDestination?: boolean;
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
  requiresRom,
  requiresDisc,
  retroArchExecutableStatus,
  onRetryRetroArchExecutable,
  onConfigureRetroArch,
  rpcs3ConfigStatus,
  onRetryRpcs3Config,
  onConfigureRpcs3,
  rpcs3DiscStatus,
  rpcs3IdentityError = false,
  onRetryRpcs3Disc,
  hasError,
  errorMessageKey,
  progress,
  onSync,
  onSelectExecutable,
  onAutomaticSyncChange,
  onResolveConflict,
  rpcs3Profile,
  onSelectRpcs3Profile,
  isBindingRpcs3Profile = false,
  emulatorDestinations,
  onSelectEmulatorDestination,
  onRemoveEmulatorDestination,
  isBindingEmulatorDestination = false,
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
  const panelMode = getCloudSavePanelMode(
    hasExecutablePath,
    rpcs3ConfigStatus,
    "content",
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
  const isSetupBlocked = panelMode !== "content";
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
            isBindingEmulatorDestination ||
            !hasExecutablePath ||
            (isSetupBlocked && !isAutomaticSyncEnabled) ||
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

      {hasUnconfiguredCustomPaths && !hasError && !isSetupBlocked ? (
        <p className="big-picture-cloud-save__error">
          {t("cloud_save_v2_unconfigured_custom_path_description")}
        </p>
      ) : null}

      {partialDescriptionKey && !hasError && !isSetupBlocked ? (
        <p className="big-picture-cloud-save__notice big-picture-cloud-save__notice--warning">
          <WarningCircleIcon size={NOTICE_ICON_SIZE} weight="fill" />
          {t(partialDescriptionKey)}
        </p>
      ) : null}

      {!isSetupBlocked &&
        rpcs3Profile &&
        rpcs3Profile.cloudProfileIds.length > 0 && (
          <section className="big-picture-cloud-save__toggle-card">
            <div className="big-picture-cloud-save__copy">
              <strong>{t("cloud_save_v2_rpcs3_profile_title")}</strong>
              <span>
                {t("cloud_save_v2_rpcs3_profile_description", {
                  localProfileId: rpcs3Profile.localProfileId,
                })}
              </span>
            </div>
            <VerticalFocusGroup regionId="big-picture-cloud-save-rpcs3-profiles">
              {rpcs3Profile.cloudProfileIds.map((cloudProfileId) => (
                <Button
                  key={cloudProfileId}
                  focusId={`big-picture-cloud-save-rpcs3-${cloudProfileId}`}
                  variant="secondary"
                  disabled={
                    isBindingRpcs3Profile ||
                    isBindingEmulatorDestination ||
                    isSyncing ||
                    isGameRunning ||
                    cloudProfileId === rpcs3Profile.linkedCloudProfileId
                  }
                  onClick={() => onSelectRpcs3Profile?.(cloudProfileId)}
                >
                  {t(
                    cloudProfileId === rpcs3Profile.linkedCloudProfileId
                      ? "cloud_save_v2_rpcs3_profile_current"
                      : "cloud_save_v2_rpcs3_profile_link_action",
                    { cloudProfileId }
                  )}
                </Button>
              ))}
            </VerticalFocusGroup>
          </section>
        )}

      {!isSetupBlocked &&
        emulatorDestinations &&
        emulatorDestinations.length > 0 && (
          <section className="big-picture-cloud-save__toggle-card">
            <div className="big-picture-cloud-save__copy">
              <strong>{t("cloud_save_v2_emulator_destinations_title")}</strong>
            </div>
            <VerticalFocusGroup regionId="big-picture-cloud-save-destinations">
              {emulatorDestinations.map((destination, index) => (
                <div
                  key={JSON.stringify([destination.rawPath, destination.kind])}
                  className="big-picture-cloud-save__copy"
                >
                  <span>
                    {t(
                      destination.kind === "state"
                        ? "cloud_save_v2_emulator_destination_states"
                        : "cloud_save_v2_emulator_destination_saves"
                    )}
                    : {destination.pathHint ?? destination.rawPath}
                  </span>
                  {destination.status === "unavailable" && (
                    <span>
                      {t("cloud_save_v2_emulator_destination_unavailable")}
                    </span>
                  )}
                  <Button
                    focusId={`big-picture-cloud-save-destination-${index}`}
                    variant="secondary"
                    disabled={
                      isBindingEmulatorDestination ||
                      isSyncing ||
                      isGameRunning ||
                      (destination.status === "unavailable" &&
                        !destination.selectedPath)
                    }
                    onClick={() =>
                      destination.selectedPath
                        ? onRemoveEmulatorDestination?.(
                            destination.rawPath,
                            destination.kind
                          )
                        : onSelectEmulatorDestination?.(
                            destination.rawPath,
                            destination.kind
                          )
                    }
                  >
                    {t(
                      destination.selectedPath
                        ? "remove"
                        : "cloud_save_v2_emulator_destination_select"
                    )}
                  </Button>
                </div>
              ))}
            </VerticalFocusGroup>
          </section>
        )}

      <section className="big-picture-cloud-save__snapshot">
        {panelMode === "skeleton" ? (
          <div className="big-picture-cloud-save__snapshot-placeholder">
            <SpinnerIcon
              size={LOADING_ICON_SIZE}
              className="big-picture-cloud-save__spinner"
            />
            <span>{t("cloud_save_v2_checking")}</span>
          </div>
        ) : panelMode === "rpcs3-config" ? (
          <div className="big-picture-cloud-save__missing-executable-copy">
            <strong>
              <WarningCircleIcon size={NOTICE_ICON_SIZE} />
              {t("cloud_save_v2_rpcs3_config_required_title")}
            </strong>
            <span>{t(getRpcs3ConfigWarningKey(rpcs3ConfigStatus)!)}</span>
          </div>
        ) : panelMode === "retroarch-config" ? (
          <div className="big-picture-cloud-save__missing-executable-copy">
            <strong>
              <WarningCircleIcon size={NOTICE_ICON_SIZE} />
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
        ) : panelMode === "missing-executable" ? (
          <div className="big-picture-cloud-save__missing-executable-copy">
            <strong>
              <WarningCircleIcon size={NOTICE_ICON_SIZE} />
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
        ) : identityBlocked ? (
          <div className="big-picture-cloud-save__missing-executable-copy">
            <strong>
              <WarningCircleIcon size={NOTICE_ICON_SIZE} />
              {t("cloud_save_v2_rpcs3_identity_title")}
            </strong>
            <span>
              {t(
                rpcs3IdentityError
                  ? "cloud_save_v2_rpcs3_identity_remote"
                  : `cloud_save_v2_rpcs3_identity_${rpcs3DiscStatus?.status ?? "unverified"}`,
                {
                  path: rpcs3DiscStatus?.path,
                  titleId: rpcs3DiscStatus?.titleId,
                }
              )}
            </span>
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

        {panelMode === "skeleton" ? (
          <Button
            focusId={PRIMARY_ACTION_ID}
            variant="primary"
            loading
            disabled
          >
            {t("cloud_save_v2_checking")}
          </Button>
        ) : panelMode === "rpcs3-config" ? (
          <Button
            focusId={PRIMARY_ACTION_ID}
            variant="primary"
            icon={
              rpcs3ConfigStatus === "error" ? (
                <ArrowClockwiseIcon size={INLINE_STATUS_ICON_SIZE} />
              ) : (
                <FolderOpenIcon size={INLINE_STATUS_ICON_SIZE} />
              )
            }
            stealFocusOnAppear={stealFocusOnActionAppear}
            onClick={
              rpcs3ConfigStatus === "error"
                ? onRetryRpcs3Config
                : onConfigureRpcs3
            }
          >
            {t(
              rpcs3ConfigStatus === "error"
                ? "cloud_save_v2_check_again"
                : "cloud_save_v2_rpcs3_config_open_settings"
            )}
          </Button>
        ) : panelMode === "retroarch-config" ? (
          <Button
            focusId={PRIMARY_ACTION_ID}
            variant="primary"
            icon={
              retroArchExecutableStatus === "error" ? (
                <ArrowClockwiseIcon size={INLINE_STATUS_ICON_SIZE} />
              ) : (
                <FolderOpenIcon size={INLINE_STATUS_ICON_SIZE} />
              )
            }
            stealFocusOnAppear={stealFocusOnActionAppear}
            onClick={
              retroArchExecutableStatus === "error"
                ? onRetryRetroArchExecutable
                : onConfigureRetroArch
            }
          >
            {t(
              retroArchExecutableStatus === "error"
                ? "cloud_save_v2_check_again"
                : "cloud_save_v2_retroarch_config_open_settings"
            )}
          </Button>
        ) : panelMode === "missing-executable" ? (
          <Button
            focusId={PRIMARY_ACTION_ID}
            variant="primary"
            icon={<FolderOpenIcon size={INLINE_STATUS_ICON_SIZE} />}
            stealFocusOnAppear={stealFocusOnActionAppear}
            onClick={onSelectExecutable}
          >
            {t(
              requiresDisc
                ? "cloud_save_v2_select_disc"
                : requiresRom
                  ? "cloud_save_v2_select_rom"
                  : "cloud_save_v2_select_executable"
            )}
          </Button>
        ) : identityBlocked ? (
          rpcs3IdentityError ? null : (
            <Button
              focusId={PRIMARY_ACTION_ID}
              variant="primary"
              icon={<FolderOpenIcon size={INLINE_STATUS_ICON_SIZE} />}
              stealFocusOnAppear={stealFocusOnActionAppear}
              onClick={
                rpcs3DiscStatus?.status === "catalogue-unavailable"
                  ? onRetryRpcs3Disc
                  : onSelectExecutable
              }
            >
              {t(
                rpcs3DiscStatus?.status === "catalogue-unavailable"
                  ? "cloud_save_v2_check_again"
                  : "cloud_save_v2_rpcs3_identity_edit_discs"
              )}
            </Button>
          )
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
              disabled={
                isLoading || isGameRunning || isBindingEmulatorDestination
              }
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
              disabled={
                isLoading || isGameRunning || isBindingEmulatorDestination
              }
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
            disabled={
              isLoading || isGameRunning || isBindingEmulatorDestination
            }
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
      closeOnBackdrop={
        !panelProps.isSyncing && !panelProps.isBindingEmulatorDestination
      }
      closeOnEscape={
        !panelProps.isSyncing && !panelProps.isBindingEmulatorDestination
      }
      closeOnB={
        !panelProps.isSyncing && !panelProps.isBindingEmulatorDestination
      }
      initialFocusId={BIG_PICTURE_CLOUD_SAVE_TOGGLE_BUTTON_ID}
      className="big-picture-cloud-save-modal"
    >
      <BigPictureCloudSavePanel {...panelProps} stealFocusOnActionAppear />
    </Modal>
  );
}
