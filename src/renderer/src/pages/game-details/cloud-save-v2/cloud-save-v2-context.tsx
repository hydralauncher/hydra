import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { AuthPage, getCloudSaveAccessAction } from "@shared";
import { ConfirmationModal } from "@renderer/components";
import { gameDetailsContext } from "@renderer/context";
import { useToast, useUserDetails } from "@renderer/hooks";
import { useSubscription } from "@renderer/hooks/use-subscription";
import type {
  CloudSaveConflictResolution,
  CloudSaveCustomPathApproval,
  CloudSaveOverview,
  CloudSaveSyncProgressPayload,
  GameShop,
} from "@types";

import { CloudSaveCustomPathApprovalModal } from "./cloud-save-custom-path-approval-modal";
import { CloudSaveModal } from "./cloud-save-modal";
import {
  getCloudSaveUploadLimitError,
  shouldSyncCloudSaveOnGamePage,
} from "./cloud-save-presentation";
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

type CustomPathApprovalError = "generic" | "mapped-overlap" | "custom-overlap";

const getCustomPathApprovalError = (
  error: unknown
): CustomPathApprovalError => {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("cloud_save_custom_path_custom_location_overlap")) {
    return "custom-overlap";
  }
  if (message.includes("cloud_save_custom_path_mapped_location_overlap")) {
    return "mapped-overlap";
  }
  return "generic";
};

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
  const { showErrorToast, showSuccessToast, showWarningToast } = useToast();
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
  const [customPathApproval, setCustomPathApproval] =
    useState<CloudSaveCustomPathApproval | null>(null);
  const [isSelectingCustomPath, setIsSelectingCustomPath] = useState(false);
  const [isConfirmingCustomPath, setIsConfirmingCustomPath] = useState(false);
  const [customPathApprovalError, setCustomPathApprovalError] =
    useState<CustomPathApprovalError | null>(null);
  const [isCustomPathApprovalGateActive, setIsCustomPathApprovalGateActive] =
    useState(searchParams.get("openCloudSavePathApproval") === "1");
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
  const gamePageSyncInFlight = useRef(false);
  const gamePageSyncCompleted = useRef(false);

  activeGameKey.current = gameKey;

  const showCloudSaveUploadLimitError = useCallback(
    (error: unknown) => {
      const limitError = getCloudSaveUploadLimitError(error);
      if (!limitError) return false;

      showErrorToast(
        t(
          limitError === "snapshot-too-large"
            ? "cloud_save_v2_snapshot_too_large_title"
            : "cloud_save_v2_too_many_files_title"
        ),
        t(
          limitError === "snapshot-too-large"
            ? "cloud_save_v2_snapshot_too_large_description"
            : "cloud_save_v2_too_many_files_description"
        )
      );
      return true;
    },
    [showErrorToast, t]
  );

  useEffect(() => {
    setProgress(null);
    setHasSyncError(false);
    setIsSyncing(false);
    setIsModalVisible(false);
    setWasOpenedFromLaunchConflict(false);
    setIsFileBrowserVisible(false);
    setCustomPathApproval(null);
    setIsSelectingCustomPath(false);
    setIsConfirmingCustomPath(false);
    setCustomPathApprovalError(null);
    setIsCustomPathApprovalGateActive(false);
    setPendingResolution(null);
    gamePageSyncInFlight.current = false;
    gamePageSyncCompleted.current = false;
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
    if (
      shop !== "steam" ||
      searchParams.get("openCloudSavePathApproval") !== "1"
    ) {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("openCloudSavePathApproval");
    setIsCustomPathApprovalGateActive(true);
    setSearchParams(nextSearchParams, { replace: true });

    let canceled = false;
    setCustomPathApprovalError(null);
    void window.electron
      .getPendingCloudSaveCustomPathApproval(objectId, shop)
      .then((approval) => {
        if (!canceled) {
          setCustomPathApproval(approval);
          setIsCustomPathApprovalGateActive(approval !== null);
        }
      })
      .catch(() => {
        if (!canceled) {
          setCustomPathApprovalError("generic");
          showErrorToast(
            t("cloud_save_v2_path_approval_error_title"),
            t("cloud_save_v2_path_approval_load_error_description")
          );
        }
      });

    return () => {
      canceled = true;
    };
  }, [objectId, searchParams, setSearchParams, shop, showErrorToast, t]);

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
        const isUploadLimitError = showCloudSaveUploadLimitError(
          event.errorCode
        );
        setHasSyncError(!isUploadLimitError);
        if (
          !isUploadLimitError &&
          event.errorCode === "cloud_save_restore_metadata_failed"
        ) {
          showErrorToast(
            t("cloud_save_v2_restore_metadata_failed_title"),
            t("cloud_save_v2_restore_metadata_failed_description")
          );
        } else if (!isUploadLimitError) {
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
    showCloudSaveUploadLimitError,
    showErrorToast,
    showWarningToast,
    t,
  ]);

  useEffect(() => {
    const isPathApprovalBlockingSync =
      isCustomPathApprovalGateActive ||
      searchParams.get("openCloudSavePathApproval") === "1";
    if (
      isPathApprovalBlockingSync ||
      !shouldSyncCloudSaveOnGamePage({
        overview,
        shop,
        canUseCloudSaves,
        hasExecutablePath,
        isGameRunning,
        isSyncing,
        isInFlight: gamePageSyncInFlight.current,
        isCompleted: gamePageSyncCompleted.current,
      })
    ) {
      return;
    }

    gamePageSyncInFlight.current = true;
    const requestedGame = gameKey;

    void window.electron
      .syncCloudSaveOnGamePage(objectId, shop)
      .then((response) => {
        if (activeGameKey.current !== requestedGame) return;
        if (response.accepted) gamePageSyncCompleted.current = true;
      })
      .catch(() => {
        if (activeGameKey.current !== requestedGame) return;

        setHasSyncError(true);
        showErrorToast(
          t("cloud_save_v2_auto_sync_failed_title"),
          t("cloud_save_v2_auto_sync_failed_description")
        );
      })
      .finally(() => {
        if (activeGameKey.current === requestedGame) {
          gamePageSyncInFlight.current = false;
        }
      });
  }, [
    canUseCloudSaves,
    gameKey,
    hasExecutablePath,
    isCustomPathApprovalGateActive,
    isGameRunning,
    isSyncing,
    objectId,
    overview,
    searchParams,
    shop,
    showErrorToast,
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
        const result = await window.electron.syncGameCloudSaveFromModal(
          objectId,
          shop,
          null,
          onProgress
        );
        if (result.status === "approval-required") {
          setCustomPathApproval(result.approval);
          setIsCustomPathApprovalGateActive(true);
        }
      }
    } catch (error) {
      const syncCancelled =
        error instanceof Error &&
        (error.message.includes("cloud_save_environment_changed_during_sync") ||
          error.message.includes("cloud_save_executable_missing"));
      const isUploadLimitError =
        !syncCancelled && showCloudSaveUploadLimitError(error);
      if (activeGameKey.current === requestedGame) {
        setHasSyncError(!syncCancelled && !isUploadLimitError);
      }
      if (
        !syncCancelled &&
        !isUploadLimitError &&
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

  const handleSelectCustomPathApproval = async () => {
    const approvalId = customPathApproval?.id;
    if (!approvalId || isSelectingCustomPath || isConfirmingCustomPath) return;

    setIsSelectingCustomPath(true);
    setCustomPathApprovalError(null);
    try {
      const result =
        await window.electron.selectCloudSaveCustomPathApproval(approvalId);
      if (!result.canceled) setCustomPathApproval(result.approval);
    } catch (error) {
      setCustomPathApprovalError(getCustomPathApprovalError(error));
    } finally {
      setIsSelectingCustomPath(false);
    }
  };

  const handleRequestCustomPathRebind = async (rawPath: string) => {
    if (
      isGameRunning ||
      isSyncing ||
      isSelectingCustomPath ||
      isConfirmingCustomPath
    ) {
      throw new Error("cloud_save_custom_path_sync_active");
    }

    setCustomPathApprovalError(null);
    setIsCustomPathApprovalGateActive(true);
    try {
      const approval =
        await window.electron.createCloudSaveCustomPathRebindApproval(
          objectId,
          shop,
          rawPath
        );
      setCustomPathApproval(approval);
    } catch (error) {
      setIsCustomPathApprovalGateActive(false);
      throw error;
    }
  };

  const handleConfirmCustomPathApproval = async () => {
    const approval = customPathApproval;
    const approvalId = approval?.id;
    if (!approvalId || isSelectingCustomPath || isConfirmingCustomPath) return;

    setIsConfirmingCustomPath(true);
    setCustomPathApprovalError(null);
    if (approval.purpose === "custom-path-rebind") {
      const requestedGame = gameKey;
      let wasRebound = false;
      setIsSyncing(true);
      setHasSyncError(false);
      setProgress(null);
      try {
        const confirmed =
          await window.electron.confirmCloudSaveCustomPathRebindApproval(
            approvalId,
            objectId,
            shop
          );
        wasRebound = true;
        const syncResult =
          await window.electron.syncCloudSaveAfterCustomPathRebind(
            objectId,
            shop,
            confirmed.rawPath,
            (nextProgress) => {
              if (activeGameKey.current === requestedGame) {
                setProgress(nextProgress);
              }
            }
          );
        if (activeGameKey.current === requestedGame) {
          setCustomPathApproval(null);
          setIsCustomPathApprovalGateActive(false);
          if (syncResult.finalState === "conflict") {
            setHasSyncError(true);
            showErrorToast(
              t("cloud_save_v2_custom_path_rebind_sync_error_title"),
              t("cloud_save_v2_custom_path_rebind_sync_error_description")
            );
          } else {
            showSuccessToast(t("cloud_save_v2_custom_path_rebound"));
          }
        }
      } catch (error) {
        if (activeGameKey.current === requestedGame) {
          if (wasRebound) {
            const isUploadLimitError = showCloudSaveUploadLimitError(error);
            setCustomPathApproval(null);
            setIsCustomPathApprovalGateActive(false);
            setHasSyncError(!isUploadLimitError);
            if (!isUploadLimitError) {
              showErrorToast(
                t("cloud_save_v2_custom_path_rebind_sync_error_title"),
                t("cloud_save_v2_custom_path_rebind_sync_error_description")
              );
            }
          } else {
            setCustomPathApprovalError(getCustomPathApprovalError(error));
          }
        }
      } finally {
        if (activeGameKey.current === requestedGame && wasRebound) {
          await refresh();
          await refreshFileDetails();
        }
        if (activeGameKey.current === requestedGame) {
          setIsSyncing(false);
          setIsConfirmingCustomPath(false);
        }
      }
      return;
    }

    if (approval.purpose === "manual-sync") {
      const requestedGame = gameKey;
      setIsSyncing(true);
      setHasSyncError(false);
      setProgress(null);
      try {
        const result = await window.electron.syncGameCloudSaveFromModal(
          objectId,
          shop,
          approvalId,
          (nextProgress) => {
            if (activeGameKey.current === requestedGame) {
              setProgress(nextProgress);
            }
          }
        );
        if (activeGameKey.current === requestedGame) {
          if (result.status === "approval-required") {
            setCustomPathApproval(result.approval);
            setIsCustomPathApprovalGateActive(true);
          } else {
            setCustomPathApproval(null);
            setIsCustomPathApprovalGateActive(false);
          }
        }
      } catch (error) {
        if (activeGameKey.current === requestedGame) {
          const isUploadLimitError = showCloudSaveUploadLimitError(error);
          setCustomPathApprovalError(
            isUploadLimitError ? null : getCustomPathApprovalError(error)
          );
          setHasSyncError(!isUploadLimitError);
        }
      } finally {
        if (activeGameKey.current === requestedGame) {
          await refresh();
          await refreshFileDetails();
        }
        if (activeGameKey.current === requestedGame) {
          setIsSyncing(false);
          setIsConfirmingCustomPath(false);
        }
      }
      return;
    }

    try {
      const result =
        await window.electron.confirmCloudSaveCustomPathApproval(approvalId);
      setCustomPathApproval(result.pendingApproval);
      setIsCustomPathApprovalGateActive(result.pendingApproval !== null);
    } catch (error) {
      setCustomPathApprovalError(getCustomPathApprovalError(error));
    } finally {
      setIsConfirmingCustomPath(false);
    }
  };

  const handleCloseCustomPathApproval = () => {
    if (isSelectingCustomPath || isConfirmingCustomPath) return;

    const approvalId = customPathApproval?.id;
    const purpose = customPathApproval?.purpose;
    setCustomPathApproval(null);
    setCustomPathApprovalError(null);
    if (purpose === "manual-sync" || purpose === "custom-path-rebind") {
      setIsCustomPathApprovalGateActive(false);
    }
    if (approvalId) {
      void window.electron
        .dismissCloudSaveCustomPathApproval(approvalId)
        .catch(() => undefined);
    }
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

      <CloudSaveCustomPathApprovalModal
        approval={customPathApproval}
        isSelecting={isSelectingCustomPath}
        isConfirming={isConfirmingCustomPath}
        errorMessage={
          customPathApprovalError === "mapped-overlap"
            ? t("cloud_save_v2_custom_path_mapped_overlap_error_description")
            : customPathApprovalError === "custom-overlap"
              ? t("cloud_save_v2_custom_path_custom_overlap_error_description")
              : customPathApprovalError
                ? t(
                    customPathApproval?.purpose === "manual-sync"
                      ? "cloud_save_v2_path_approval_manual_sync_error_description"
                      : customPathApproval?.purpose === "custom-path-rebind"
                        ? "cloud_save_v2_custom_path_rebind_error_description"
                        : "cloud_save_v2_path_approval_error_description"
                  )
                : undefined
        }
        onSelectPath={() => void handleSelectCustomPathApproval()}
        onConfirm={() => void handleConfirmCustomPathApproval()}
        onClose={handleCloseCustomPathApproval}
      />

      <CloudSaveModal
        visible={isModalVisible}
        showLaunchConflictWarning={wasOpenedFromLaunchConflict}
        overview={overview}
        isLoading={isRefreshing}
        isSyncing={isSyncing}
        isGameRunning={isGameRunning}
        hasExecutablePath={hasExecutablePath}
        isAutomaticSyncEnabled={overview?.isAutomaticSyncEnabled ?? null}
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
        isGameRunning={isGameRunning}
        isSyncing={isSyncing}
        onRetry={async () => {
          await refreshFileDetails();
          await refresh();
        }}
        onRequestCustomPathRebind={handleRequestCustomPathRebind}
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
