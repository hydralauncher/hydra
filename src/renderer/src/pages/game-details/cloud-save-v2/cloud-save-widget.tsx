import { useTranslation } from "react-i18next";

import type { CloudSaveOverview, CloudSaveSyncProgressPayload } from "@types";

import { CloudSaveStatusIcon } from "./cloud-save-status-icon";
import { useCloudSaveV2 } from "./cloud-save-v2-context";
import "./cloud-save-v2.scss";

const statusKey = (overview: CloudSaveOverview | null) => {
  if (!overview) return "cloud_save_v2_checking";
  if (overview.state === "synced") return "cloud_save_v2_synced";
  if (overview.state === "conflict") return "cloud_save_v2_conflict";
  if (overview.state === "untracked") return "cloud_save";
  return "cloud_save_v2_outdated";
};

const statusTone = (
  overview: CloudSaveOverview | null,
  hasError: boolean,
  isSyncing: boolean
) => {
  if (isSyncing || hasError || !overview) return "neutral";
  if (overview.state === "synced") return "synced";
  if (overview.state === "conflict") return "conflict";
  return "outdated";
};

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

  let label = t(statusKey(overview));
  if (!hasExecutablePath) {
    label = t("cloud_save_v2_outdated");
  } else if (!canUseCloudSaves) {
    label = t("cloud_save");
  } else if (isSyncing) {
    label = t("cloud_save_v2_syncing");
  } else if (hasError) {
    label = t("cloud_save_v2_unavailable");
  }
  const tone = hasExecutablePath
    ? statusTone(overview, hasError, isSyncing)
    : "outdated";
  const progressPercentage = getProgressPercentage(progress);
  const isChecking = hasExecutablePath && isRefreshing && !overview;

  return (
    <button
      type="button"
      className={`game-details__cloud-sync-button cloud-save-v2__trigger cloud-save-v2__trigger--${tone}`}
      onClick={openManager}
      title={t("cloud_save")}
    >
      <CloudSaveStatusIcon
        overview={overview}
        isChecking={isChecking}
        isSyncing={hasExecutablePath && isSyncing}
        hasError={hasExecutablePath && hasError}
        isAvailable={canUseCloudSaves}
        hasExecutablePath={hasExecutablePath}
        progress={hasExecutablePath ? progress : null}
      />
      {isChecking ? t("cloud_save_v2_checking") : label}
      {hasExecutablePath && isSyncing && (
        <span
          aria-hidden="true"
          className="cloud-save-v2__sync-progress-bar"
          style={{ width: `${progressPercentage}%` }}
        />
      )}
    </button>
  );
}
