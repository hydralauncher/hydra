import { useTranslation } from "react-i18next";
import Skeleton from "react-loading-skeleton";
import {
  ArrowClockwiseIcon,
  CircleNotchIcon,
  CloudIcon,
  FolderOpenIcon,
} from "@phosphor-icons/react";
import { Button, Link, TextField } from "@renderer/components";
import { useDate } from "@renderer/hooks";
import { useEpicCloudSaveControls } from "@renderer/hooks/use-epic-cloud-save-controls";
import { getEpicManagedError } from "@renderer/helpers/epic-managed-error";
import type { EpicCloudSaveStatus, EpicSaveError, LibraryGame } from "@types";
import { CloudSaveStatusIcon } from "../../cloud-save-v2/cloud-save-status-icon";
import type {
  CloudSavePresentationIcon,
  CloudSavePresentationTone,
} from "../../cloud-save-v2/cloud-save-presentation";
import "../../cloud-save-v2/cloud-save-v2.scss";
import "./epic-cloud-section.scss";

const STATUS_PRESENTATION: Record<
  EpicCloudSaveStatus,
  { icon: CloudSavePresentationIcon; tone: CloudSavePresentationTone }
> = {
  idle: { icon: "cloud", tone: "neutral" },
  syncing: { icon: "spinner", tone: "neutral" },
  "up-to-date": { icon: "synced", tone: "synced" },
  "pending-upload": { icon: "upload", tone: "outdated" },
  conflict: { icon: "warning", tone: "conflict" },
  unavailable: { icon: "cloud-x", tone: "neutral" },
};

const RETRYABLE_SAVE_ERRORS = new Set<EpicSaveError>([
  "network",
  "timeout",
  "save-sync-failed",
  "save-verification-failed",
  "save-operation-active",
  "game-running",
]);

export function EpicCloudSettingsSection({
  game,
  isGameRunning,
}: Readonly<{ game: LibraryGame; isGameRunning: boolean }>) {
  const { t } = useTranslation("game_details");
  const { formatDateTime } = useDate();
  const cloud = useEpicCloudSaveControls(game);
  const { state } = cloud;
  const initialLoading = !state && cloud.available && !cloud.readError;
  const status =
    cloud.readError || !cloud.available
      ? "unavailable"
      : (state?.status ?? "unavailable");
  const presentation = STATUS_PRESENTATION[status];
  const unavailable =
    !cloud.available ||
    cloud.readError ||
    !state ||
    (status === "unavailable" &&
      state.error !== "save-path-required" &&
      state.error !== "invalid-path");
  const disabled = unavailable || cloud.loading || cloud.busy || isGameRunning;
  const settingsDisabled =
    !cloud.available || !state || cloud.loading || cloud.busy || isGameRunning;
  const error =
    cloud.readError || !cloud.available
      ? "network"
      : (state?.error ?? (cloud.failure ? "save-sync-failed" : undefined));
  const errorTranslation = error ? getEpicManagedError(error) : null;
  const canRetrySync =
    !cloud.readError &&
    !!state?.supportsCloudSaves &&
    !!state.savePath &&
    !!error &&
    RETRYABLE_SAVE_ERRORS.has(error);
  const hasError =
    !!errorTranslation &&
    error !== "save-conflict" &&
    error !== "save-path-required" &&
    error !== "saves-unsupported";
  const formatModifiedAt = (value: string | null | undefined) =>
    value && !Number.isNaN(new Date(value).getTime())
      ? formatDateTime(value)
      : "—";

  return (
    <section
      className="game-options-modal__cloud-panel game-options-modal__cloud-panel--v2 epic-cloud-settings"
      aria-label={t("epic_cloud_saves")}
    >
      <div className="game-options-modal__panel-header">
        <h2>{t("epic_cloud_saves")}</h2>
        <p>{t("epic_cloud_saves_description")}</p>
      </div>

      {initialLoading ? (
        <div
          className="epic-cloud-settings__skeleton"
          aria-busy="true"
          aria-label={t("epic_save_status_idle")}
        >
          <Skeleton height={66} borderRadius={8} />
          <Skeleton height={150} borderRadius={8} />
        </div>
      ) : (
        <>
          {state?.supportsCloudSaves && (
            <div className="cloud-save-v2__toggle-row">
              <div className="cloud-save-v2__toggle-copy">
                <strong>{t("epic_save_automatic")}</strong>
                <span>{t("epic_save_automatic_description")}</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={state.automaticSync}
                aria-label={t("epic_save_automatic")}
                disabled={settingsDisabled}
                className={`cloud-save-v2__switch ${state.automaticSync ? "cloud-save-v2__switch--enabled" : ""}`}
                onClick={() => void cloud.updateSettings(!state.automaticSync)}
              >
                <span className="cloud-save-v2__switch-thumb" />
              </button>
            </div>
          )}

          {isGameRunning && (
            <p className="cloud-save-v2__game-running-warning">
              {t("cloud_save_v2_close_game_before_manual_sync")}
            </p>
          )}

          <article className="cloud-save-v2__snapshot cloud-save-v2__snapshot--active">
            <div className="cloud-save-v2__snapshot-header">
              <strong className="epic-cloud-settings__status-title">
                <CloudSaveStatusIcon icon={presentation.icon} />
                Epic Games
              </strong>
              <span
                role="status"
                className={`cloud-save-v2__status-pill cloud-save-v2__status-pill--${presentation.tone}`}
              >
                {t(`epic_save_status_${status}`)}
              </span>
            </div>

            {state &&
              !state.supportsCloudSaves &&
              (!state.error || state.error === "saves-unsupported") && (
                <p className="epic-cloud-settings__path-hint">
                  {t("epic_save_unsupported")}
                </p>
              )}

            {hasError && errorTranslation && (
              <div className="epic-cloud-settings__error" role="alert">
                <p>{t(errorTranslation.key, { ns: errorTranslation.ns })}</p>
                <div className="epic-cloud-settings__error-actions">
                  <Button
                    theme="outline"
                    disabled={cloud.loading || cloud.busy || isGameRunning}
                    onClick={() =>
                      void (canRetrySync ? cloud.sync() : cloud.refresh())
                    }
                  >
                    <ArrowClockwiseIcon size={16} />
                    {t("epic_retry")}
                  </Button>
                  <Link to="/settings?tab=integrations">
                    {t("integrations", { ns: "settings" })}
                  </Link>
                </div>
              </div>
            )}

            {state?.supportsCloudSaves && (
              <div className="epic-cloud-settings__path">
                <TextField
                  label={t("epic_save_folder")}
                  value={state.savePath ?? ""}
                  placeholder={t("epic_save_path_required")}
                  title={state.savePath ?? undefined}
                  readOnly
                  rightContent={
                    <Button
                      theme="outline"
                      disabled={settingsDisabled}
                      onClick={() => void cloud.choosePath()}
                    >
                      <FolderOpenIcon size={16} />
                      {t("epic_save_select_path")}
                    </Button>
                  }
                />
                {!state.savePath && (
                  <p className="epic-cloud-settings__path-hint">
                    {t("epic_save_path_required")}
                  </p>
                )}
              </div>
            )}

            {state?.supportsCloudSaves && status === "conflict" ? (
              <>
                <p className="epic-cloud-settings__conflict-description">
                  {t("epic_save_conflict_description")}
                </p>
                <div className="epic-cloud-settings__conflict-copies">
                  <div className="epic-cloud-settings__conflict-copy">
                    <strong>{t("cloud_save_v2_local")}</strong>
                    <span>{formatModifiedAt(state.localModifiedAt)}</span>
                    <Button
                      disabled={disabled}
                      onClick={() => void cloud.resolve("local")}
                    >
                      {t("epic_save_use_local")}
                    </Button>
                  </div>
                  <div className="epic-cloud-settings__conflict-copy">
                    <strong>Epic Games</strong>
                    <span>{formatModifiedAt(state.remoteModifiedAt)}</span>
                    <Button
                      theme="outline"
                      disabled={disabled}
                      onClick={() => void cloud.resolve("remote")}
                    >
                      {t("epic_save_use_remote")}
                    </Button>
                  </div>
                </div>
              </>
            ) : state?.supportsCloudSaves ? (
              <div className="cloud-save-v2__action-area cloud-save-v2__action-area--with-snapshot">
                <Button
                  className="cloud-save-v2__sync-button"
                  disabled={
                    disabled ||
                    !state.savePath ||
                    state.error === "invalid-path"
                  }
                  onClick={() => void cloud.sync()}
                >
                  {cloud.busy ? (
                    <CircleNotchIcon
                      className="cloud-save-v2__spinner"
                      size={18}
                    />
                  ) : (
                    <CloudIcon size={18} />
                  )}
                  <span>
                    {t(
                      cloud.busy
                        ? "epic_save_status_syncing"
                        : "epic_save_sync_now"
                    )}
                  </span>
                </Button>
              </div>
            ) : null}
          </article>
        </>
      )}
    </section>
  );
}
