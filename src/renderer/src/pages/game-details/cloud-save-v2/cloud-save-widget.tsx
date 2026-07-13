import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { CloudIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import type {
  CloudSaveOverview,
  CloudSaveSyncProgressPayload,
  GameShop,
} from "@types";
import { AuthPage } from "@shared";
import { gameDetailsContext } from "@renderer/context";
import { useUserDetails } from "@renderer/hooks";

import { CloudSaveModal } from "./cloud-save-modal";
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
  const { setShowGameOptionsModal, setGameOptionsInitialCategory } =
    useContext(gameDetailsContext);
  const [overview, setOverview] = useState<CloudSaveOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<CloudSaveSyncProgressPayload | null>(
    null
  );
  const [hasError, setHasError] = useState(false);
  const gameKey = `${shop}:${objectId}`;
  const activeGameKey = useRef(gameKey);

  activeGameKey.current = gameKey;

  const loadOverview = useCallback(async () => {
    const requestedGame = gameKey;
    setIsLoading(true);
    setHasError(false);
    try {
      const result = await window.electron.getCloudSaveOverview(objectId, shop);
      if (activeGameKey.current === requestedGame) setOverview(result);
    } catch {
      if (activeGameKey.current === requestedGame) setHasError(true);
    } finally {
      if (activeGameKey.current === requestedGame) setIsLoading(false);
    }
  }, [gameKey, objectId, shop]);

  useEffect(() => {
    setOverview(null);
    setProgress(null);
    setHasError(false);
    setIsModalVisible(false);

    if (userDetails && hasActiveSubscription) void loadOverview();
  }, [gameKey, hasActiveSubscription, loadOverview, userDetails]);

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
    setHasError(false);
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
      if (activeGameKey.current === requestedGame) await loadOverview();
    } catch {
      if (activeGameKey.current === requestedGame) setHasError(true);
    } finally {
      if (activeGameKey.current === requestedGame) setIsSyncing(false);
    }
  };

  const canUseCloudSaves = Boolean(userDetails && hasActiveSubscription);
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
        {isLoading ? t("cloud_save_v2_checking") : label}
      </button>

      <CloudSaveModal
        visible={isModalVisible}
        overview={overview}
        isLoading={isLoading}
        isSyncing={isSyncing}
        hasError={hasError}
        progress={progress}
        onSync={handleSync}
        onClose={() => setIsModalVisible(false)}
      />
    </>
  );
}
