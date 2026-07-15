import { useContext, useEffect, useRef, useState } from "react";
import {
  CircleNotchIcon,
  CloudArrowDownIcon,
  CloudArrowUpIcon,
  CloudCheckIcon,
  CloudIcon,
  CloudSlashIcon,
  CloudWarningIcon,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

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
import { useCloudSaveOverview } from "./use-cloud-save-overview";
import "./cloud-save-v2.scss";

interface CloudSaveWidgetProps {
  objectId: string;
  shop: GameShop;
}

const statusKey = (overview: CloudSaveOverview | null) => {
  if (!overview) return "cloud_save_v2_checking";
  if (overview.state === "synced") return "cloud_save_v2_synced";
  if (overview.state === "conflict") return "cloud_save_v2_conflict";
  if (overview.state === "untracked") return "cloud_save_v2_not_synced";
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

const getStatusIcon = (
  overview: CloudSaveOverview | null,
  isChecking: boolean,
  isSyncing: boolean,
  hasError: boolean,
  progress: CloudSaveSyncProgressPayload | null
) => {
  if (hasError) {
    return <CloudSlashIcon size={22} weight="fill" />;
  }
  if (progress?.stage === "uploading") {
    return <CloudArrowUpIcon size={22} weight="fill" />;
  }
  if (progress?.stage === "restoring") {
    return <CloudArrowDownIcon size={22} weight="fill" />;
  }
  if (isChecking || isSyncing) {
    return <CircleNotchIcon className="cloud-save-v2__spinner" size={22} />;
  }
  if (overview?.state === "synced") {
    return <CloudCheckIcon size={22} weight="fill" />;
  }
  if (
    overview?.state === "conflict" ||
    overview?.state === "local-ahead" ||
    overview?.state === "remote-ahead"
  ) {
    return <CloudWarningIcon size={22} weight="fill" />;
  }
  return <CloudIcon size={22} weight="fill" />;
};

export function CloudSaveWidget({
  objectId,
  shop,
}: Readonly<CloudSaveWidgetProps>) {
  const { t } = useTranslation("game_details");
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { showErrorToast, showWarningToast } = useToast();
  const {
    game,
    isGameRunning,
    setShowGameOptionsModal,
    setGameOptionsInitialCategory,
  } = useContext(gameDetailsContext);
  const canUseCloudSaves = Boolean(userDetails && hasActiveSubscription);
  const { overview, isRefreshing, hasRefreshError, refresh } =
    useCloudSaveOverview({
      objectId,
      shop,
      enabled: canUseCloudSaves,
      isGameRunning,
      canAutomaticallySync: Boolean(game?.executablePath),
    });
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<CloudSaveSyncProgressPayload | null>(
    null
  );
  const [hasSyncError, setHasSyncError] = useState(false);
  const [pendingResolution, setPendingResolution] =
    useState<CloudSaveConflictResolution | null>(null);
  const gameKey = `${shop}:${objectId}`;
  const activeGameKey = useRef(gameKey);

  activeGameKey.current = gameKey;

  useEffect(() => {
    setProgress(null);
    setHasSyncError(false);
    setIsSyncing(false);
    setIsModalVisible(false);
    setPendingResolution(null);
  }, [gameKey]);

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
        if (event.status === "conflict") {
          showWarningToast(
            t("cloud_save_v2_auto_sync_conflict_title"),
            t("cloud_save_v2_auto_sync_conflict_description")
          );
        }
      }

      const requestedGame = `${event.gameId.shop}:${event.gameId.objectId}`;
      void refresh({ allowAutomaticSync: false }).finally(() => {
        if (activeGameKey.current === requestedGame) {
          setIsSyncing(false);
        }
      });
    });
  }, [objectId, refresh, shop, showErrorToast, showWarningToast, t]);

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
    setIsModalVisible(true);
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
        await refresh({ allowAutomaticSync: false });
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
    label = t("cloud_save_v2");
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
        title={t("cloud_save_v2")}
      >
        {getStatusIcon(overview, isChecking, isSyncing, hasError, progress)}
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
        overview={overview}
        isLoading={isRefreshing}
        isSyncing={isSyncing}
        hasError={hasError}
        progress={progress}
        onSync={() => void runCloudSaveOperation()}
        onResolveConflict={setPendingResolution}
        onClose={() => setIsModalVisible(false)}
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
