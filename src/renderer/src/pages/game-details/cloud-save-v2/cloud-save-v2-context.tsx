import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { AuthPage, getCloudSaveAccessAction } from "@shared";
import { ConfirmationModal } from "@renderer/components";
import { gameDetailsContext } from "@renderer/context";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import type {
  CloudSaveConflictResolution,
  CloudSaveOverview,
  CloudSaveSyncProgressPayload,
  GameShop,
} from "@types";

import { CloudSaveModal } from "./cloud-save-modal";
import { CloudSaveV2FileBrowserModal } from "./cloud-save-v2-file-browser-modal";
import { useCloudSaveOverview } from "./use-cloud-save-overview";
import { useCloudSaveV2FileDetails } from "./use-cloud-save-v2-file-details";

interface CloudSaveV2ContextValue {
  overview: CloudSaveOverview | null;
  isRefreshing: boolean;
  isSyncing: boolean;
  isGameRunning: boolean;
  hasError: boolean;
  progress: CloudSaveSyncProgressPayload | null;
  hasExecutablePath: boolean;
  canUseCloudSaves: boolean;
  openManager: () => void;
  openFileBrowser: () => void;
  runCloudSaveOperation: (
    resolution?: CloudSaveConflictResolution
  ) => Promise<void>;
  setAutomaticSyncEnabled: (enabled: boolean) => Promise<void>;
  requestConflictResolution: (resolution: CloudSaveConflictResolution) => void;
}

const cloudSaveV2Context = createContext<CloudSaveV2ContextValue | null>(null);

export const useCloudSaveV2 = () => {
  const context = useContext(cloudSaveV2Context);
  if (!context) {
    throw new Error("useCloudSaveV2 must be used within CloudSaveV2Provider");
  }

  return context;
};

interface CloudSaveV2ProviderProps {
  children: React.ReactNode;
  objectId: string;
  shop: GameShop;
}

export function CloudSaveV2Provider({
  children,
  objectId,
  shop,
}: Readonly<CloudSaveV2ProviderProps>) {
  const { t } = useTranslation("game_details");
  const [searchParams, setSearchParams] = useSearchParams();
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();
  const { showErrorToast, showWarningToast } = useToast();
  const {
    game,
    isGameRunning,
    setShowGameOptionsModal,
    setGameOptionsInitialCategory,
  } = useContext(gameDetailsContext);
  const cloudSaveAccessAction = getCloudSaveAccessAction(
    Boolean(userDetails),
    hasActiveSubscription
  );
  const canUseCloudSaves = cloudSaveAccessAction === "open";
  const hasExecutablePath = Boolean(game?.executablePath);
  const canCheckCloudSaves =
    shop === "steam" && canUseCloudSaves && hasExecutablePath;
  const { overview, isRefreshing, hasRefreshError, refresh } =
    useCloudSaveOverview({
      objectId,
      shop,
      enabled: canCheckCloudSaves,
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
    enabled: canCheckCloudSaves && isFileBrowserVisible,
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

  const wasGameRunning = useRef(isGameRunning);

  useEffect(() => {
    const gameJustClosed = wasGameRunning.current && !isGameRunning;
    wasGameRunning.current = isGameRunning;

    if (isGameRunning) {
      setPendingResolution(null);
    } else if (gameJustClosed) {
      void refresh();
    }
  }, [isGameRunning, refresh]);

  useEffect(() => {
    if (shop !== "steam" || searchParams.get("openCloudSaveConflict") !== "1") {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("openCloudSaveConflict");
    setSearchParams(nextSearchParams, { replace: true });

    if (cloudSaveAccessAction === "sign-in") {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }
    if (cloudSaveAccessAction === "paywall") {
      showHydraCloudModal("backup");
      return;
    }

    setIsFileBrowserVisible(false);
    setWasOpenedFromLaunchConflict(true);
    setIsModalVisible(true);
  }, [
    cloudSaveAccessAction,
    searchParams,
    setSearchParams,
    shop,
    showHydraCloudModal,
  ]);

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
        if (event.errorCode === "cloud_save_restore_metadata_failed") {
          showErrorToast(
            t("cloud_save_v2_restore_metadata_failed_title"),
            t("cloud_save_v2_restore_metadata_failed_description")
          );
        } else {
          showErrorToast(
            t("cloud_save_v2_auto_sync_failed_title"),
            t("cloud_save_v2_auto_sync_failed_description")
          );
        }
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

  const openManager = () => {
    if (cloudSaveAccessAction === "sign-in") {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }
    if (cloudSaveAccessAction === "paywall") {
      showHydraCloudModal("backup");
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
    if (isGameRunning || !hasExecutablePath || shop !== "steam") return;
    if (cloudSaveAccessAction !== "open") {
      if (cloudSaveAccessAction === "sign-in") {
        window.electron.openAuthWindow(AuthPage.SignIn);
      } else {
        showHydraCloudModal("backup");
      }
      return;
    }

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
    } catch (error) {
      if (activeGameKey.current === requestedGame) setHasSyncError(true);
      if (
        error instanceof Error &&
        error.message.includes("cloud_save_restore_metadata_failed")
      ) {
        showErrorToast(
          t("cloud_save_v2_restore_metadata_failed_title"),
          t("cloud_save_v2_restore_metadata_failed_description")
        );
      }
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

  const setAutomaticSyncEnabled = async (enabled: boolean) => {
    if (cloudSaveAccessAction !== "open") {
      if (cloudSaveAccessAction === "sign-in") {
        window.electron.openAuthWindow(AuthPage.SignIn);
      } else {
        showHydraCloudModal("backup");
      }
      throw new Error("Cloud Saves require an active subscription");
    }
    await window.electron.setCloudSaveAutomaticSyncEnabled(
      objectId,
      shop,
      enabled
    );
    await refresh();
  };

  const handleConfirmResolution = () => {
    const resolution = pendingResolution;
    setPendingResolution(null);
    if (resolution) void runCloudSaveOperation(resolution);
  };

  const hasError = hasRefreshError || hasSyncError;
  const value: CloudSaveV2ContextValue = {
    overview,
    isRefreshing,
    isSyncing,
    isGameRunning,
    hasError,
    progress,
    hasExecutablePath,
    canUseCloudSaves,
    openManager,
    openFileBrowser: () => {
      if (cloudSaveAccessAction === "open") {
        setIsFileBrowserVisible(true);
      } else if (cloudSaveAccessAction === "sign-in") {
        window.electron.openAuthWindow(AuthPage.SignIn);
      } else {
        showHydraCloudModal("backup");
      }
    },
    runCloudSaveOperation,
    setAutomaticSyncEnabled,
    requestConflictResolution: setPendingResolution,
  };

  return (
    <cloudSaveV2Context.Provider value={value}>
      {children}

      <CloudSaveModal
        visible={isModalVisible}
        showLaunchConflictWarning={wasOpenedFromLaunchConflict}
        overview={overview}
        isLoading={isRefreshing}
        isSyncing={isSyncing}
        isGameRunning={isGameRunning}
        hasExecutablePath={hasExecutablePath}
        isAutomaticSyncEnabled={overview?.isAutomaticSyncEnabled ?? true}
        hasError={hasError}
        progress={progress}
        onSync={() => void runCloudSaveOperation()}
        onOpenFileBrowser={() => setIsFileBrowserVisible(true)}
        onSelectExecutable={handleSelectExecutable}
        onAutomaticSyncChange={setAutomaticSyncEnabled}
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
    </cloudSaveV2Context.Provider>
  );
}
