import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  getCloudSaveSyncErrorKind,
  shouldSyncCloudSaveOnGamePage,
} from "./cloud-save-presentation";
import { CloudSaveV2FileBrowserModal } from "./cloud-save-v2-file-browser-modal";
import { useCloudSaveOverview } from "./use-cloud-save-overview";
import { useCloudSaveV2FileDetails } from "./use-cloud-save-v2-file-details";

interface CloudSaveV2ContextValue {
  overview: CloudSaveOverview | null;
  isAutomaticSyncEnabled: boolean | null;
  isRefreshing: boolean;
  isSyncing: boolean;
  isGameRunning: boolean;
  hasError: boolean;
  errorMessageKey:
    | "cloud_save_v2_load_error"
    | "cloud_save_v2_sync_error"
    | null;
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

type CustomPathApprovalError =
  | "generic"
  | "mapped-overlap"
  | "custom-overlap"
  | "remote-target-overlap"
  | "environment-unavailable"
  | "foreign-environment"
  | "unreadable";

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
  if (message.includes("cloud_save_custom_path_remote_target_overlap")) {
    return "remote-target-overlap";
  }
  if (message.includes("cloud_save_custom_path_environment_unavailable")) {
    return "environment-unavailable";
  }
  if (message.includes("cloud_save_custom_path_foreign_environment")) {
    return "foreign-environment";
  }
  if (message.includes("cloud_save_custom_path_unreadable")) {
    return "unreadable";
  }
  return "generic";
};

const getCustomPathApprovalErrorKey = (
  error: CustomPathApprovalError | null,
  purpose: CloudSaveCustomPathApproval["purpose"] | undefined
) => {
  if (error === "mapped-overlap") {
    return "cloud_save_v2_custom_path_mapped_overlap_error_description";
  }
  if (error === "custom-overlap") {
    return "cloud_save_v2_custom_path_custom_overlap_error_description";
  }
  if (error === "remote-target-overlap") {
    return "cloud_save_v2_custom_path_remote_target_overlap_error_description";
  }
  if (error === "environment-unavailable") {
    return "cloud_save_v2_custom_path_environment_error_description";
  }
  if (error === "foreign-environment") {
    return "cloud_save_v2_custom_path_wine_environment_error_description";
  }
  if (error === "unreadable") {
    return "cloud_save_v2_custom_path_read_error_description";
  }
  if (!error) return null;
  if (purpose === "manual-sync") {
    return "cloud_save_v2_path_approval_manual_sync_error_description";
  }
  if (purpose === "custom-path-rebind") {
    return "cloud_save_v2_custom_path_rebind_error_description";
  }
  return "cloud_save_v2_path_approval_error_description";
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
  const { showMedusaCloudModal } = useSubscription();
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
  const {
    overview,
    isAutomaticSyncEnabled,
    isRefreshing,
    hasRefreshError,
    refresh,
  } = useCloudSaveOverview({
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

  activeGameKey.current = gameKey;

  const showKnownCloudSaveSyncError = useCallback(
    (error: unknown) => {
      const errorKind = getCloudSaveSyncErrorKind(error);
      if (errorKind === "generic") return false;

      if (errorKind === "restore-metadata") {
        showErrorToast(
          t("cloud_save_v2_restore_metadata_failed_title"),
          t("cloud_save_v2_restore_metadata_failed_description")
        );
        return true;
      }

      showErrorToast(
        t(
          errorKind === "snapshot-too-large"
            ? "cloud_save_v2_snapshot_too_large_title"
            : "cloud_save_v2_too_many_files_title"
        ),
        t(
          errorKind === "snapshot-too-large"
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
      showMedusaCloudModal("backup");
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
    showMedusaCloudModal,
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
        const isKnownError = showKnownCloudSaveSyncError(event.errorCode);
        setHasSyncError(!isKnownError);
        if (!isKnownError) {
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
    showKnownCloudSaveSyncError,
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
      })
    ) {
      return;
    }

    gamePageSyncInFlight.current = true;
    const requestedGame = gameKey;

    void window.electron
      .syncCloudSaveOnGamePage(objectId, shop)
      .catch((error) => {
        if (activeGameKey.current !== requestedGame) return;

        const isKnownError = showKnownCloudSaveSyncError(error);
        setHasSyncError(!isKnownError);
        if (!isKnownError) {
          showErrorToast(
            t("cloud_save_v2_auto_sync_failed_title"),
            t("cloud_save_v2_auto_sync_failed_description")
          );
        }
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
    showKnownCloudSaveSyncError,
    showErrorToast,
    t,
  ]);

  const openManager = useCallback(() => {
    if (cloudSaveAccessAction === "sign-in") {
      window.electron.openAuthWindow(AuthPage.SignIn);
      return;
    }
    if (cloudSaveAccessAction === "paywall") {
      showMedusaCloudModal("backup");
      return;
    }
    setWasOpenedFromLaunchConflict(false);
    setIsModalVisible(true);
  }, [cloudSaveAccessAction, showMedusaCloudModal]);

  const handleSelectExecutable = () => {
    setIsModalVisible(false);
    setWasOpenedFromLaunchConflict(false);
    setIsFileBrowserVisible(false);
    setGameOptionsInitialCategory("locations");
    setShowGameOptionsModal(true);
  };

  const handleCloudSaveOperationError = useCallback(
    (error: unknown, requestedGame: string) => {
      const syncCancelled =
        error instanceof Error &&
        (error.message.includes("cloud_save_environment_changed_during_sync") ||
          error.message.includes("cloud_save_executable_missing"));
      const isKnownError = !syncCancelled && showKnownCloudSaveSyncError(error);
      if (activeGameKey.current === requestedGame) {
        setHasSyncError(!syncCancelled && !isKnownError);
      }
    },
    [showKnownCloudSaveSyncError]
  );

  const runFileBrowserCloudSaveOperation = useCallback(
    async <T,>(
      operation: (
        onProgress: (progress: CloudSaveSyncProgressPayload) => void
      ) => Promise<T>
    ): Promise<T> => {
      const requestedGame = gameKey;
      setIsSyncing(true);
      setHasSyncError(false);
      setProgress(null);

      try {
        return await operation((nextProgress) => {
          if (activeGameKey.current === requestedGame) {
            setProgress(nextProgress);
          }
        });
      } catch (error) {
        handleCloudSaveOperationError(error, requestedGame);
        throw error;
      } finally {
        if (activeGameKey.current === requestedGame) {
          await refresh();
          await refreshFileDetails();
          setIsSyncing(false);
        }
      }
    },
    [gameKey, handleCloudSaveOperationError, refresh, refreshFileDetails]
  );

  const syncAfterCustomPathAdded = useCallback(
    () =>
      runFileBrowserCloudSaveOperation((onProgress) =>
        window.electron.syncGameCloudSave(objectId, shop, onProgress)
      ),
    [objectId, runFileBrowserCloudSaveOperation, shop]
  );

  const removeTrackedCustomPath = useCallback(
    (rawPath: string) =>
      runFileBrowserCloudSaveOperation(async () => {
        await window.electron.removeCloudSaveCustomPath(
          objectId,
          shop,
          rawPath
        );
      }),
    [objectId, runFileBrowserCloudSaveOperation, shop]
  );

  const runCloudSaveOperation = useCallback(
    async (resolution?: CloudSaveConflictResolution) => {
      if (isGameRunning || !hasExecutablePath || shop !== "steam") return;
      if (cloudSaveAccessAction !== "open") {
        openManager();
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
        handleCloudSaveOperationError(error, requestedGame);
      } finally {
        if (activeGameKey.current === requestedGame) {
          await refresh();
          await refreshFileDetails();
          setIsSyncing(false);
        }
      }
    },
    [
      cloudSaveAccessAction,
      gameKey,
      handleCloudSaveOperationError,
      hasExecutablePath,
      isGameRunning,
      objectId,
      openManager,
      refresh,
      refreshFileDetails,
      shop,
    ]
  );

  const setAutomaticSyncEnabled = useCallback(
    async (enabled: boolean) => {
      if (cloudSaveAccessAction !== "open") {
        if (cloudSaveAccessAction === "sign-in") {
          window.electron.openAuthWindow(AuthPage.SignIn);
        } else {
          showMedusaCloudModal("backup");
        }
        throw new Error("Cloud Saves require an active subscription");
      }
      try {
        await window.electron.setCloudSaveAutomaticSyncEnabled(
          objectId,
          shop,
          enabled
        );
        await refresh();
      } catch (error) {
        showErrorToast(
          t("cloud_save_v2_toggle_error_title"),
          t("cloud_save_v2_toggle_error_description")
        );
        throw error;
      }
    },
    [
      cloudSaveAccessAction,
      objectId,
      refresh,
      shop,
      showErrorToast,
      showMedusaCloudModal,
      t,
    ]
  );

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

  const showCustomPathRebindSyncError = () => {
    showErrorToast(
      t("cloud_save_v2_custom_path_rebind_sync_error_title"),
      t("cloud_save_v2_custom_path_rebind_sync_error_description")
    );
  };

  const handleCustomPathRebindError = (
    error: unknown,
    requestedGame: string,
    wasRebound: boolean
  ) => {
    if (activeGameKey.current !== requestedGame) return;
    if (!wasRebound) {
      setCustomPathApprovalError(getCustomPathApprovalError(error));
      return;
    }

    const isKnownError = showKnownCloudSaveSyncError(error);
    setCustomPathApproval(null);
    setIsCustomPathApprovalGateActive(false);
    setHasSyncError(!isKnownError);
    if (!isKnownError) showCustomPathRebindSyncError();
  };

  const confirmCustomPathRebind = async (approvalId: string) => {
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
          showCustomPathRebindSyncError();
        } else {
          showSuccessToast(t("cloud_save_v2_custom_path_rebound"));
        }
      }
    } catch (error) {
      handleCustomPathRebindError(error, requestedGame, wasRebound);
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
  };

  const confirmManualCustomPath = async (approvalId: string) => {
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
        const isKnownError = showKnownCloudSaveSyncError(error);
        setCustomPathApprovalError(
          isKnownError ? null : getCustomPathApprovalError(error)
        );
        setHasSyncError(!isKnownError);
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
  };

  const confirmPreLaunchCustomPath = async (approvalId: string) => {
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

  const handleConfirmCustomPathApproval = async () => {
    const approval = customPathApproval;
    const approvalId = approval?.id;
    if (!approvalId || isSelectingCustomPath || isConfirmingCustomPath) return;

    setIsConfirmingCustomPath(true);
    setCustomPathApprovalError(null);
    if (approval.purpose === "custom-path-rebind") {
      await confirmCustomPathRebind(approvalId);
      return;
    }
    if (approval.purpose === "manual-sync") {
      await confirmManualCustomPath(approvalId);
      return;
    }
    await confirmPreLaunchCustomPath(approvalId);
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
  let errorMessageKey: CloudSaveV2ContextValue["errorMessageKey"] = null;
  if (hasSyncError) {
    errorMessageKey = "cloud_save_v2_sync_error";
  } else if (hasRefreshError) {
    errorMessageKey = "cloud_save_v2_load_error";
  }
  const openFileBrowser = useCallback(() => {
    if (cloudSaveAccessAction === "open") {
      setIsFileBrowserVisible(true);
    } else if (cloudSaveAccessAction === "sign-in") {
      window.electron.openAuthWindow(AuthPage.SignIn);
    } else {
      showMedusaCloudModal("backup");
    }
  }, [cloudSaveAccessAction, showMedusaCloudModal]);
  const value = useMemo<CloudSaveV2ContextValue>(
    () => ({
      overview,
      isAutomaticSyncEnabled,
      isRefreshing,
      isSyncing,
      isGameRunning,
      hasError,
      errorMessageKey,
      progress,
      hasExecutablePath,
      canUseCloudSaves,
      openManager,
      openFileBrowser,
      runCloudSaveOperation,
      setAutomaticSyncEnabled,
      requestConflictResolution: setPendingResolution,
    }),
    [
      canUseCloudSaves,
      errorMessageKey,
      hasError,
      hasExecutablePath,
      isAutomaticSyncEnabled,
      isGameRunning,
      isRefreshing,
      isSyncing,
      openManager,
      openFileBrowser,
      overview,
      progress,
      runCloudSaveOperation,
      setAutomaticSyncEnabled,
    ]
  );
  const customPathApprovalErrorKey = getCustomPathApprovalErrorKey(
    customPathApprovalError,
    customPathApproval?.purpose
  );

  return (
    <cloudSaveV2Context.Provider value={value}>
      {children}

      <CloudSaveCustomPathApprovalModal
        approval={customPathApproval}
        isSelecting={isSelectingCustomPath}
        isConfirming={isConfirmingCustomPath}
        errorMessage={
          customPathApprovalErrorKey ? t(customPathApprovalErrorKey) : undefined
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
        isAutomaticSyncEnabled={isAutomaticSyncEnabled}
        hasError={hasError}
        errorMessageKey={errorMessageKey}
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
        progress={progress}
        onRetry={async () => {
          await refreshFileDetails();
          await refresh();
        }}
        onSyncAfterCustomPathAdded={syncAfterCustomPathAdded}
        onRemoveTrackedCustomPath={removeTrackedCustomPath}
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
