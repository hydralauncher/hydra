import { useContext, useEffect, useRef, useState } from "react";
import { CloudIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import type {
  CloudSaveOverview,
  CloudSaveSyncProgressPayload,
  GameShop,
} from "@types";
import { AuthPage } from "@shared";
import { gameDetailsContext } from "@renderer/context";
import { useToast, useUserDetails } from "@renderer/hooks";

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

const statusTone = (overview: CloudSaveOverview | null, hasError: boolean) => {
  if (hasError || !overview) return "neutral";
  if (overview.state === "synced") return "synced";
  if (overview.state === "conflict") return "conflict";
  return "outdated";
};

export function CloudSaveWidget({ objectId, shop }: CloudSaveWidgetProps) {
  const { t } = useTranslation("game_details");
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { showErrorToast, showWarningToast } = useToast();
  const { setShowGameOptionsModal, setGameOptionsInitialCategory } =
    useContext(gameDetailsContext);
  const canUseCloudSaves = Boolean(userDetails && hasActiveSubscription);
  const { overview, isRefreshing, hasRefreshError, refresh } =
    useCloudSaveOverview({
      objectId,
      shop,
      enabled: canUseCloudSaves,
    });
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<CloudSaveSyncProgressPayload | null>(
    null
  );
  const [hasSyncError, setHasSyncError] = useState(false);
  const gameKey = `${shop}:${objectId}`;
  const activeGameKey = useRef(gameKey);

  activeGameKey.current = gameKey;

  useEffect(() => {
    setProgress(null);
    setHasSyncError(false);
    setIsModalVisible(false);
  }, [gameKey]);

  useEffect(() => {
    return window.electron.onCloudSaveAutomaticSync((event) => {
      if (event.gameId.objectId !== objectId || event.gameId.shop !== shop) {
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

      void refresh();
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

  const handleSync = async () => {
    const requestedGame = gameKey;
    setIsSyncing(true);
    setHasSyncError(false);
    setProgress(null);
    try {
      await window.electron.syncGameCloudSave(
        objectId,
        shop,
        (nextProgress) => {
          if (activeGameKey.current === requestedGame) {
            setProgress(nextProgress);
          }
        }
      );
      if (activeGameKey.current === requestedGame) await refresh();
    } catch {
      if (activeGameKey.current === requestedGame) setHasSyncError(true);
    } finally {
      if (activeGameKey.current === requestedGame) setIsSyncing(false);
    }
  };

  const hasError = hasRefreshError || hasSyncError;
  const label = !canUseCloudSaves
    ? t("cloud_save_v2")
    : hasError
      ? t("cloud_save_v2_unavailable")
      : t(statusKey(overview));
  const tone = statusTone(overview, hasError);

  return (
    <>
      <button
        type="button"
        className={`game-details__cloud-sync-button cloud-save-v2__trigger cloud-save-v2__trigger--${tone}`}
        onClick={handleOpen}
        title={t("cloud_save_v2")}
      >
        <CloudIcon size={16} />
        {isRefreshing && !overview ? t("cloud_save_v2_checking") : label}
      </button>

      <CloudSaveModal
        visible={isModalVisible}
        overview={overview}
        isLoading={isRefreshing}
        isSyncing={isSyncing}
        hasError={hasError}
        progress={progress}
        onSync={handleSync}
        onClose={() => setIsModalVisible(false)}
      />
    </>
  );
}
