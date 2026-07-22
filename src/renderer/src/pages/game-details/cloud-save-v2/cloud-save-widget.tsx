import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import type {
  CloudSaveConflictResolution,
  CloudSaveOverview,
  CloudSaveSyncProgressPayload,
  GameShop,
} from "@types";
import { AuthPage } from "@shared";
import { gameDetailsContext } from "@renderer/context";
import { useToast, useUserDetails } from "@renderer/hooks";
import { ConfirmationModal } from "@renderer/components";

import { CloudSaveModal } from "./cloud-save-modal";
import { CloudSaveV2FileBrowserModal } from "./cloud-save-v2-file-browser-modal";
import { CloudSaveStatusIcon } from "./cloud-save-status-icon";
import { useCloudSaveOverview } from "./use-cloud-save-overview";
import { useCloudSaveV2FileDetails } from "./use-cloud-save-v2-file-details";
import "./cloud-save-v2.scss";

interface CloudSaveWidgetProps {
  objectId: string;
  shop: GameShop;
}

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

export function CloudSaveWidget({
  objectId,
  shop,
}: Readonly<CloudSaveWidgetProps>) {
  const { t } = useTranslation("game_details");
  const [searchParams, setSearchParams] = useSearchParams();
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { showErrorToast, showWarningToast } = useToast();
  const { game, setShowGameOptionsModal, setGameOptionsInitialCategory } =
    useContext(gameDetailsContext);
  const canUseCloudSaves = Boolean(userDetails && hasActiveSubscription);
  const { overview, isRefreshing, hasRefreshError, refresh } =
    useCloudSaveOverview({
      objectId,
      shop,
      enabled: canUseCloudSaves,
    });
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [wasOpenedFromLaunchConflict, setWasOpenedFromLaunchConflict] =
    useState(false);
  const [isFileBrowserVisible, setIsFileBrowserVisible] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<CloudSaveSyncProgressPayload | null>(
    null
  );
  const [hasSyncError, setHasSyncError] = useState(false);
  const [pendingResolution, setPendingResolution] =
    useState<CloudSaveConflictResolution | null>(null);
  const {
    details: fileDetails,
    isLoading: isFileDetailsLoading,
    hasError: hasFileDetailsError,
    refresh: refreshFileDetails,
  } = useCloudSaveV2FileDetails({
    objectId,
    shop,
    enabled:
      canUseCloudSaves && isFileBrowserVisible && Boolean(game?.executablePath),
  });
  const gameKey = `${shop}:${objectId}`;
  const activeGameKey = useRef(gameKey);

  activeGameKey.current = gameKey;

  useEffect(() => {
    setProgress(null);
    setHasSyncError(false);
    setIsSyncing(false);
    setIsModalVisible(false);
    setWasOpenedFromLaunchConflict(false);
    setIsFileBrowserVisible(false);
    setPendingResolution(null);
  }, [gameKey]);

  useEffect(() => {
    if (searchParams.get("openCloudSaveConflict") !== "1") return;

    setIsFileBrowserVisible(false);
    setWasOpenedFromLaunchConflict(true);
    setIsModalVisible(true);

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("openCloudSaveConflict");
    setSearchParams(nextSearchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    return window.electron.onCloudSaveAutomaticSync((event) => {
      if (event.gameId.objectId !== objectId || event.gameId.shop !== shop) {
        return;
      }

      if (event.status === "progress") {
        setIsSyncing(true);
        setHasSyncError(false);
        setProgress(event.progress);
        return;
      }

      if (event.status === "failed") {
        setHasSyncError(true);
        showErrorToast(
          t("cloud_save_v2_auto_sync_failed_title"),
          t("cloud_save_v2_auto_sync_failed_description")
        );
      } else {
        setHasSyncError(false);
        if (event.status === "conflict" && event.trigger !== "pre-launch") {
          showWarningToast(
            t("cloud_save_v2_auto_sync_conflict_title"),
            t("cloud_save_v2_auto_sync_conflict_description")
          );
        }
      }

      const requestedGame = `${event.gameId.shop}:${event.gameId.objectId}`;
      void refresh()
        .then(() => refreshFileDetails())
        .finally(() => {
          if (activeGameKey.current === requestedGame) {
            setIsSyncing(false);
          }
        });
    });
  }, [
    objectId,
    refresh,
    refreshFileDetails,
    shop,
    showErrorToast,
    showWarningToast,
    t,
  ]);

  const handleOpen = () => {
    if (!userDetails) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }
    if (!hasActiveSubscription) {
      setGameOptionsInitialCategory("hydra_cloud");
      setShowGameOptionsModal(true);
      return;
    }
    setWasOpenedFromLaunchConflict(false);
    setIsModalVisible(true);
  };

  const handleSelectExecutable = () => {
    setIsModalVisible(false);
    setWasOpenedFromLaunchConflict(false);
    setIsFileBrowserVisible(false);
    setGameOptionsInitialCategory("locations");
    setShowGameOptionsModal(true);
  };

  const runCloudSaveOperation = async (
    resolution?: CloudSaveConflictResolution
  ) => {
    const requestedGame = gameKey;
    setIsSyncing(true);
    setHasSyncError(false);
    setProgress(null);
    try {
      const onProgress = (nextProgress: CloudSaveSyncProgressPayload) => {
        if (activeGameKey.current === requestedGame) {
          setProgress(nextProgress);
        }
      };
      if (resolution) {
        await window.electron.resolveCloudSaveConflict(
          objectId,
          shop,
          resolution,
          onProgress
        );
      } else {
        await window.electron.syncGameCloudSave(objectId, shop, onProgress);
      }
    } catch {
      if (activeGameKey.current === requestedGame) setHasSyncError(true);
    } finally {
      if (activeGameKey.current === requestedGame) {
        await refresh();
        await refreshFileDetails();
      }
      if (activeGameKey.current === requestedGame) {
        setIsSyncing(false);
      }
    }
  };

  const handleConfirmResolution = () => {
    const resolution = pendingResolution;
    setPendingResolution(null);
    if (resolution) void runCloudSaveOperation(resolution);
  };

  const hasError = hasRefreshError || hasSyncError;
  let label = t(statusKey(overview));
  if (!canUseCloudSaves) {
    label = t("cloud_save");
  } else if (isSyncing) {
    label = t("cloud_save_v2_syncing");
  } else if (hasError) {
    label = t("cloud_save_v2_unavailable");
  }
  const tone = statusTone(overview, hasError, isSyncing);
  const progressPercentage = getProgressPercentage(progress);
  const isChecking = isRefreshing && !overview;

  return (
    <>
      <button
        type="button"
        className={`game-details__cloud-sync-button cloud-save-v2__trigger cloud-save-v2__trigger--${tone}`}
        onClick={handleOpen}
        title={t("cloud_save")}
      >
        <CloudSaveStatusIcon
          overview={overview}
          isChecking={isChecking}
          isSyncing={isSyncing}
          hasError={hasError}
          isAvailable={canUseCloudSaves}
          hasExecutablePath={Boolean(game?.executablePath)}
          progress={progress}
        />
        {isChecking ? t("cloud_save_v2_checking") : label}
        {isSyncing && (
          <span
            aria-hidden="true"
            className="cloud-save-v2__sync-progress-bar"
            style={{ width: `${progressPercentage}%` }}
          />
        )}
      </button>

      <CloudSaveModal
        visible={isModalVisible}
        showLaunchConflictWarning={wasOpenedFromLaunchConflict}
        overview={overview}
        isLoading={isRefreshing}
        isSyncing={isSyncing}
        hasExecutablePath={Boolean(game?.executablePath)}
        isAutomaticSyncEnabled={overview?.isAutomaticSyncEnabled ?? true}
        hasError={hasError}
        progress={progress}
        onSync={() => void runCloudSaveOperation()}
        onOpenFileBrowser={() => setIsFileBrowserVisible(true)}
        onSelectExecutable={handleSelectExecutable}
        onAutomaticSyncChange={async (enabled) => {
          await window.electron.setCloudSaveAutomaticSyncEnabled(
            objectId,
            shop,
            enabled
          );
          await refresh();
        }}
        onResolveConflict={setPendingResolution}
        onClose={() => {
          setIsFileBrowserVisible(false);
          setIsModalVisible(false);
          setWasOpenedFromLaunchConflict(false);
        }}
      />

      <CloudSaveV2FileBrowserModal
        visible={isFileBrowserVisible}
        objectId={objectId}
        shop={shop}
        overviewState={overview?.state ?? null}
        details={fileDetails}
        isLoading={isFileDetailsLoading}
        hasError={hasFileDetailsError}
        onRetry={() => void refreshFileDetails()}
        onClose={() => setIsFileBrowserVisible(false)}
      />

      <ConfirmationModal
        visible={pendingResolution !== null}
        title={
          pendingResolution === "keep-local"
            ? t("cloud_save_v2_confirm_local_title")
            : t("cloud_save_v2_confirm_remote_title")
        }
        descriptionText={
          pendingResolution === "keep-local"
            ? t("cloud_save_v2_confirm_local_description")
            : t("cloud_save_v2_confirm_remote_description")
        }
        confirmButtonLabel={
          pendingResolution === "keep-local"
            ? t("cloud_save_v2_keep_local")
            : t("cloud_save_v2_keep_remote")
        }
        cancelButtonLabel={t("cloud_save_v2_cancel")}
        onConfirm={handleConfirmResolution}
        onClose={() => setPendingResolution(null)}
      />
    </>
  );
}
