import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import {
  getCloudSaveUploadLimitError,
  shouldSyncCloudSaveOnGamePage,
} from "@renderer/pages/game-details/cloud-save-v2/cloud-save-presentation";
import { useCloudSaveOverview } from "@renderer/pages/game-details/cloud-save-v2/use-cloud-save-overview";
import type {
  CloudSaveConflictResolution,
  CloudSaveCustomPathApproval,
  CloudSaveOverview,
  CloudSaveSyncProgressPayload,
  GameShop,
} from "@types";

import { useBigPictureToast, useUserDetails } from "../../../../hooks";
import { BigPictureCloudSaveConflictModal } from "./cloud-save-conflict-modal";
import { BigPictureCloudSaveCustomPathModal } from "./cloud-save-custom-path-modal";
import { BigPictureCloudSaveModal } from "./cloud-save-modal";

import "./styles.scss";

type CustomPathApprovalError = "generic" | "mapped-overlap" | "custom-overlap";

interface BigPictureCloudSaveContextValue {
  overview: CloudSaveOverview | null;
  isRefreshing: boolean;
  isSyncing: boolean;
  hasError: boolean;
  progress: CloudSaveSyncProgressPayload | null;
  canUseCloudSaves: boolean;
  hasExecutablePath: boolean;
  openManager: () => void;
}

const bigPictureCloudSaveContext =
  createContext<BigPictureCloudSaveContextValue | null>(null);

function getCustomPathApprovalError(error: unknown): CustomPathApprovalError {
  const message = error instanceof Error ? error.message : "";

  if (message.includes("cloud_save_custom_path_custom_location_overlap")) {
    return "custom-overlap";
  }
  if (message.includes("cloud_save_custom_path_mapped_location_overlap")) {
    return "mapped-overlap";
  }
  return "generic";
}

export function useBigPictureCloudSave() {
  const context = useContext(bigPictureCloudSaveContext);

  if (!context) {
    throw new Error(
      "useBigPictureCloudSave must be used within BigPictureCloudSaveProvider"
    );
  }

  return context;
}

interface BigPictureCloudSaveProviderProps {
  children: ReactNode;
  objectId: string;
  shop: GameShop;
  hasExecutablePath: boolean;
  isGameRunning: boolean;
  onSelectExecutable: () => void;
}

export function BigPictureCloudSaveProvider({
  children,
  objectId,
  shop,
  hasExecutablePath,
  isGameRunning,
  onSelectExecutable,
}: Readonly<BigPictureCloudSaveProviderProps>) {
  const { t } = useTranslation("game_details");
  const [searchParams, setSearchParams] = useSearchParams();
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { showErrorToast, showSuccessToast, showWarningToast } =
    useBigPictureToast();
  const canUseCloudSaves = Boolean(userDetails) && hasActiveSubscription;
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
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasSyncError, setHasSyncError] = useState(false);
  const [progress, setProgress] = useState<CloudSaveSyncProgressPayload | null>(
    null
  );
  const [customPathApproval, setCustomPathApproval] =
    useState<CloudSaveCustomPathApproval | null>(null);
  const [customPathApprovalError, setCustomPathApprovalError] =
    useState<CustomPathApprovalError | null>(null);
  const [isSelectingCustomPath, setIsSelectingCustomPath] = useState(false);
  const [isConfirmingCustomPath, setIsConfirmingCustomPath] = useState(false);
  const [isFileExplorerVisible, setIsFileExplorerVisible] = useState(false);
  const [pendingResolution, setPendingResolution] =
    useState<CloudSaveConflictResolution | null>(null);
  const gameKey = `${shop}:${objectId}`;
  const activeGameKey = useRef(gameKey);
  const gamePageSyncInFlight = useRef(false);
  const gamePageSyncCompleted = useRef(false);

  activeGameKey.current = gameKey;

  const showSyncError = useCallback(
    (error: unknown) => {
      const limitError = getCloudSaveUploadLimitError(error);

      if (limitError) {
        showErrorToast(
          t(
            limitError === "snapshot-too-large"
              ? "cloud_save_v2_snapshot_too_large_title"
              : "cloud_save_v2_too_many_files_title"
          ),
          {
            message: t(
              limitError === "snapshot-too-large"
                ? "cloud_save_v2_snapshot_too_large_description"
                : "cloud_save_v2_too_many_files_description"
            ),
          }
        );
        return true;
      }

      showErrorToast(t("cloud_save_v2_auto_sync_failed_title"), {
        message: t("cloud_save_v2_auto_sync_failed_description"),
      });
      return false;
    },
    [showErrorToast, t]
  );

  useEffect(() => {
    setIsModalVisible(false);
    setWasOpenedFromLaunchConflict(false);
    setIsSyncing(false);
    setHasSyncError(false);
    setProgress(null);
    setCustomPathApproval(null);
    setCustomPathApprovalError(null);
    setIsSelectingCustomPath(false);
    setIsConfirmingCustomPath(false);
    setIsFileExplorerVisible(false);
    setPendingResolution(null);
    gamePageSyncInFlight.current = false;
    gamePageSyncCompleted.current = false;
  }, [gameKey]);

  useEffect(() => {
    if (shop !== "steam" || searchParams.get("openCloudSaveConflict") !== "1") {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("openCloudSaveConflict");
    setSearchParams(nextSearchParams, { replace: true });
    setWasOpenedFromLaunchConflict(true);
    setIsModalVisible(true);
  }, [searchParams, setSearchParams, shop]);

  useEffect(() => {
    if (
      shop !== "steam" ||
      searchParams.get("openCloudSavePathApproval") !== "1"
    ) {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("openCloudSavePathApproval");
    setSearchParams(nextSearchParams, { replace: true });

    let canceled = false;
    setCustomPathApprovalError(null);
    void globalThis.window.electron
      .getPendingCloudSaveCustomPathApproval(objectId, shop)
      .then((approval) => {
        if (!canceled) setCustomPathApproval(approval);
      })
      .catch(() => {
        if (canceled) return;
        setCustomPathApprovalError("generic");
        showErrorToast(t("cloud_save_v2_path_approval_error_title"), {
          message: t("cloud_save_v2_path_approval_load_error_description"),
        });
      });

    return () => {
      canceled = true;
    };
  }, [objectId, searchParams, setSearchParams, shop, showErrorToast, t]);

  useEffect(() => {
    return globalThis.window.electron.onCloudSaveAutomaticSync((event) => {
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
        showSyncError(event.errorCode);
      } else {
        setHasSyncError(false);
        if (event.status === "conflict" && event.trigger !== "pre-launch") {
          showWarningToast(t("cloud_save_v2_auto_sync_conflict_title"), {
            message: t("cloud_save_v2_auto_sync_conflict_description"),
          });
        }
      }

      const requestedGame = `${event.gameId.shop}:${event.gameId.objectId}`;
      void refresh().finally(() => {
        if (activeGameKey.current === requestedGame) {
          setIsSyncing(false);
        }
      });
    });
  }, [objectId, refresh, shop, showSyncError, showWarningToast, t]);

  useEffect(() => {
    if (
      customPathApproval !== null ||
      searchParams.get("openCloudSavePathApproval") === "1" ||
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

    const requestedGame = gameKey;
    gamePageSyncInFlight.current = true;

    void globalThis.window.electron
      .syncCloudSaveOnGamePage(objectId, shop)
      .then((response) => {
        if (activeGameKey.current === requestedGame && response.accepted) {
          gamePageSyncCompleted.current = true;
        }
      })
      .catch((error) => {
        if (activeGameKey.current !== requestedGame) return;
        const isLimitError = showSyncError(error);
        setHasSyncError(!isLimitError);
      })
      .finally(() => {
        if (activeGameKey.current === requestedGame) {
          gamePageSyncInFlight.current = false;
        }
      });
  }, [
    canUseCloudSaves,
    customPathApproval,
    gameKey,
    hasExecutablePath,
    isGameRunning,
    isSyncing,
    objectId,
    overview,
    searchParams,
    shop,
    showSyncError,
  ]);

  const runCloudSaveOperation = useCallback(
    async (resolution?: CloudSaveConflictResolution) => {
      if (
        isGameRunning ||
        isSyncing ||
        !hasExecutablePath ||
        !canUseCloudSaves ||
        shop !== "steam"
      ) {
        return false;
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
          await globalThis.window.electron.resolveCloudSaveConflict(
            objectId,
            shop,
            resolution,
            onProgress
          );
        } else {
          const result =
            await globalThis.window.electron.syncGameCloudSaveFromModal(
              objectId,
              shop,
              null,
              onProgress
            );

          if (
            activeGameKey.current === requestedGame &&
            result.status === "approval-required"
          ) {
            setCustomPathApproval(result.approval);
          }
        }
        return true;
      } catch (error) {
        if (activeGameKey.current === requestedGame) {
          const isLimitError = showSyncError(error);
          setHasSyncError(!isLimitError);
        }
        return false;
      } finally {
        if (activeGameKey.current === requestedGame) {
          await refresh();
          setIsSyncing(false);
        }
      }
    },
    [
      canUseCloudSaves,
      gameKey,
      hasExecutablePath,
      isGameRunning,
      isSyncing,
      objectId,
      refresh,
      shop,
      showSyncError,
    ]
  );

  const handleAutomaticSyncChange = async (enabled: boolean) => {
    if (!canUseCloudSaves) {
      throw new Error("Cloud Saves require an active subscription");
    }

    await globalThis.window.electron.setCloudSaveAutomaticSyncEnabled(
      objectId,
      shop,
      enabled
    );
    await refresh();
  };

  const handleSelectCustomPath = async (selectedPath: string) => {
    const approvalId = customPathApproval?.id;
    if (!approvalId || isSelectingCustomPath || isConfirmingCustomPath) return;

    setIsFileExplorerVisible(false);
    setIsSelectingCustomPath(true);
    setCustomPathApprovalError(null);

    try {
      const result =
        await globalThis.window.electron.selectCloudSaveCustomPathApproval(
          approvalId,
          selectedPath
        );
      if (!result.canceled) setCustomPathApproval(result.approval);
    } catch (error) {
      setCustomPathApprovalError(getCustomPathApprovalError(error));
    } finally {
      setIsSelectingCustomPath(false);
    }
  };

  const handleConfirmCustomPathApproval = async () => {
    const approval = customPathApproval;
    if (!approval || isSelectingCustomPath || isConfirmingCustomPath) return;

    const requestedGame = gameKey;
    setIsConfirmingCustomPath(true);
    setCustomPathApprovalError(null);

    try {
      if (approval.purpose === "manual-sync") {
        setIsSyncing(true);
        const result =
          await globalThis.window.electron.syncGameCloudSaveFromModal(
            objectId,
            shop,
            approval.id,
            (nextProgress) => {
              if (activeGameKey.current === requestedGame) {
                setProgress(nextProgress);
              }
            }
          );

        if (activeGameKey.current === requestedGame) {
          setCustomPathApproval(
            result.status === "approval-required" ? result.approval : null
          );
        }
      } else if (approval.purpose === "custom-path-rebind") {
        const confirmed =
          await globalThis.window.electron.confirmCloudSaveCustomPathRebindApproval(
            approval.id,
            objectId,
            shop
          );
        setIsSyncing(true);
        await globalThis.window.electron.syncCloudSaveAfterCustomPathRebind(
          objectId,
          shop,
          confirmed.rawPath,
          (nextProgress) => {
            if (activeGameKey.current === requestedGame) {
              setProgress(nextProgress);
            }
          }
        );
        setCustomPathApproval(null);
        showSuccessToast(t("cloud_save_v2_custom_path_rebound"));
      } else {
        const result =
          await globalThis.window.electron.confirmCloudSaveCustomPathApproval(
            approval.id
          );
        setCustomPathApproval(result.pendingApproval);
      }
    } catch (error) {
      setCustomPathApprovalError(getCustomPathApprovalError(error));
      if (approval.purpose !== "pre-launch") {
        setHasSyncError(true);
      }
    } finally {
      if (activeGameKey.current === requestedGame) {
        await refresh();
        setIsSyncing(false);
        setIsConfirmingCustomPath(false);
      }
    }
  };

  const handleCloseCustomPathApproval = () => {
    if (isSelectingCustomPath || isConfirmingCustomPath) return;

    const approvalId = customPathApproval?.id;
    setCustomPathApproval(null);
    setCustomPathApprovalError(null);
    setIsFileExplorerVisible(false);

    if (approvalId) {
      void globalThis.window.electron
        .dismissCloudSaveCustomPathApproval(approvalId)
        .catch(() => undefined);
    }
  };

  const handleConfirmResolution = () => {
    const resolution = pendingResolution;
    if (!resolution) return;

    void runCloudSaveOperation(resolution).then((completed) => {
      if (completed) setPendingResolution(null);
    });
  };

  const customPathErrorMessage =
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
          : undefined;
  const hasError = hasRefreshError || hasSyncError;
  const value: BigPictureCloudSaveContextValue = {
    overview,
    isRefreshing,
    isSyncing,
    hasError,
    progress,
    canUseCloudSaves,
    hasExecutablePath,
    openManager: () => {
      if (!canUseCloudSaves) {
        showErrorToast(t("cloud_save_v2_unavailable"));
        return;
      }
      setWasOpenedFromLaunchConflict(false);
      setIsModalVisible(true);
    },
  };

  return (
    <bigPictureCloudSaveContext.Provider value={value}>
      {children}

      <BigPictureCloudSaveModal
        visible={isModalVisible}
        showLaunchConflictWarning={wasOpenedFromLaunchConflict}
        overview={overview}
        isLoading={isRefreshing}
        isSyncing={isSyncing}
        isGameRunning={isGameRunning}
        hasExecutablePath={hasExecutablePath}
        hasError={hasError}
        progress={progress}
        onSync={() => void runCloudSaveOperation()}
        onSelectExecutable={() => {
          setIsModalVisible(false);
          onSelectExecutable();
        }}
        onAutomaticSyncChange={handleAutomaticSyncChange}
        onResolveConflict={setPendingResolution}
        onClose={() => {
          setIsModalVisible(false);
          setWasOpenedFromLaunchConflict(false);
        }}
      />

      <BigPictureCloudSaveCustomPathModal
        approval={customPathApproval}
        isSelecting={isSelectingCustomPath}
        isConfirming={isConfirmingCustomPath}
        isFileExplorerVisible={isFileExplorerVisible}
        errorMessage={customPathErrorMessage}
        onOpenFileExplorer={() => setIsFileExplorerVisible(true)}
        onCloseFileExplorer={() => setIsFileExplorerVisible(false)}
        onSelectPath={(path) => void handleSelectCustomPath(path)}
        onConfirm={() => void handleConfirmCustomPathApproval()}
        onClose={handleCloseCustomPathApproval}
      />

      <BigPictureCloudSaveConflictModal
        resolution={pendingResolution}
        isResolving={isSyncing}
        onClose={() => setPendingResolution(null)}
        onConfirm={handleConfirmResolution}
      />
    </bigPictureCloudSaveContext.Provider>
  );
}
