import { useTranslation } from "react-i18next";

import type { CloudSaveSyncProgressPayload } from "@types";

import { CloudSaveStatusIcon } from "./cloud-save-status-icon";
import { getCloudSavePresentation } from "./cloud-save-presentation";
import { useCloudSaveV2 } from "./cloud-save-v2-context";
import "./cloud-save-v2.scss";

const getProgressPercentage = (
  progress: CloudSaveSyncProgressPayload | null
) => {
  if (!progress) return 0;
  if (progress.stage === "completed") return 100;
  if (progress.totalFiles <= 0) return 0;

  const percentage = (progress.processedFiles / progress.totalFiles) * 100;
  return Math.min(100, Math.max(0, percentage));
};

export function CloudSaveWidget() {
  const { t } = useTranslation("game_details");
  const {
    overview,
    isRefreshing,
    isSyncing,
    hasError,
    progress,
    hasExecutablePath,
    canUseCloudSaves,
    openManager,
  } = useCloudSaveV2();

  const isChecking = hasExecutablePath && isRefreshing && !overview;
  const presentation = getCloudSavePresentation({
    canUseCloudSaves,
    hasExecutablePath,
    isChecking,
    isSyncing,
    hasError,
    state: overview?.state ?? null,
    progressStage: isSyncing ? (progress?.stage ?? null) : null,
  });
  const progressPercentage = getProgressPercentage(progress);
  const showSyncProgress =
    presentation.labelKey === "cloud_save_v2_syncing" && isSyncing;

  return (
    <button
      type="button"
      className={`game-details__cloud-sync-button cloud-save-v2__trigger cloud-save-v2__trigger--${presentation.tone}`}
      onClick={openManager}
      title={t("cloud_save")}
    >
      <CloudSaveStatusIcon icon={presentation.icon} />
      {t(presentation.labelKey)}
      {showSyncProgress && (
        <span
          aria-hidden="true"
          className="cloud-save-v2__sync-progress-bar"
          style={{ width: `${progressPercentage}%` }}
        />
      )}
    </button>
  );
}
