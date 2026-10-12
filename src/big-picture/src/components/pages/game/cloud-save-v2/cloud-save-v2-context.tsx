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
import { useNavigate, useSearchParams } from "react-router-dom";
import { getCloudSaveEmulatorProvider, isCloudSaveV2Eligible } from "@shared";

import {
  getCloudSaveSyncErrorKind,
  shouldSyncCloudSaveOnGamePage,
} from "@renderer/pages/game-details/cloud-save-v2/cloud-save-presentation";
import { useCloudSaveOverview } from "@renderer/pages/game-details/cloud-save-v2/use-cloud-save-overview";
import { useCloudSaveV2FileDetails } from "@renderer/pages/game-details/cloud-save-v2/use-cloud-save-v2-file-details";
import {
  isRetroArchExecutableError,
  isRetroArchSetupBlocked,
  RETROARCH_CONFIG_SETTINGS_URL,
} from "@renderer/pages/game-details/cloud-save-v2/retroarch-executable-status";
import { useRetroArchExecutableStatus } from "@renderer/pages/game-details/cloud-save-v2/use-retroarch-executable-status";
import { useRpcs3ConfigStatus } from "@renderer/pages/game-details/cloud-save-v2/use-rpcs3-config-status";
import { RPCS3_CONFIG_SETTINGS_URL } from "@renderer/pages/game-details/cloud-save-v2/rpcs3-config-presentation";
import type {
  CloudSaveConflictResolution,
  CloudSaveCustomPathApproval,
  CloudSaveOverview,
  CloudSaveSyncProgressPayload,
  GameShop,
  RetroArchLegacyBatteryCandidate,
  RetroArchLocalBatteryCandidate,
  Rpcs3DiscIdentityStatus,
} from "@types";

import { useBigPictureToast, useUserDetails } from "../../../../hooks";
import { BigPictureCloudSaveConflictModal } from "./cloud-save-conflict-modal";
import { BigPictureCloudSaveCustomPathModal } from "./cloud-save-custom-path-modal";
import { BigPictureRpcs3ProfileModal } from "./cloud-save-rpcs3-profile-modal";
import { BigPictureRetroArchBatteryModal } from "./cloud-save-retroarch-battery-modal";
import {
  BigPictureCloudSaveModal,
  type BigPictureCloudSavePanelProps,
} from "./cloud-save-modal";
import { shouldLoadBigPictureEmulatorDetails } from "./cloud-save-v2-presentation";

import "./styles.scss";

type CustomPathApprovalError =
  | "generic"
  | "mapped-overlap"
  | "custom-overlap"
  | "remote-target-overlap"
  | "environment-unavailable"
  | "foreign-environment"
  | "unreadable";

interface BigPictureCloudSaveContextValue {
  overview: CloudSaveOverview | null;
  isRefreshing: boolean;
  isSyncing: boolean;
  hasError: boolean;
  progress: CloudSaveSyncProgressPayload | null;
  canUseCloudSaves: boolean;
  hasExecutablePath: boolean;
  openManager: () => void;
  panelProps: Omit<
    BigPictureCloudSavePanelProps,
    "showLaunchConflictWarning" | "onSelectExecutable"
  >;
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
}

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
  platform?: string | null;
  hasExecutablePath: boolean;
  isGameRunning: boolean;
  enableGamePageSync?: boolean;
  onSelectExecutable: () => void;
}

export function BigPictureCloudSaveProvider({
  children,
  objectId,
  shop,
  platform,
  hasExecutablePath,
  isGameRunning,
  enableGamePageSync = true,
  onSelectExecutable,
}: Readonly<BigPictureCloudSaveProviderProps>) {
  const { t } = useTranslation("game_details");
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { showErrorToast, showSuccessToast, showWarningToast } =
    useBigPictureToast();
  const canUseCloudSaves = Boolean(userDetails) && hasActiveSubscription;
  const eligible = isCloudSaveV2Eligible(shop, platform);
  const canCheckEmulator = eligible && canUseCloudSaves;
  const canCheckCloudSaves = canCheckEmulator && hasExecutablePath;
  const { overview, isRefreshing, hasRefreshError, refreshErrorCode, refresh } =
    useCloudSaveOverview({
      objectId,
      shop,
      enabled: canCheckCloudSaves,
    });
  const emulatorProvider = getCloudSaveEmulatorProvider(shop, platform);
  const { details: fileDetails, refresh: refreshFileDetails } =
    useCloudSaveV2FileDetails({
      objectId,
      shop,
      enabled: shouldLoadBigPictureEmulatorDetails(
        canCheckCloudSaves,
        emulatorProvider
      ),
    });

  const gameKey = `${shop}:${objectId}`;
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const {
    status: retroArchExecutableStatus,
    retry: retryRetroArchExecutableStatus,
  } = useRetroArchExecutableStatus(
    emulatorProvider === "retroarch" && canCheckEmulator,
    gameKey,
    isModalVisible
  );
  const { status: rpcs3ConfigStatus, retry: retryRpcs3Config } =
    useRpcs3ConfigStatus(
      emulatorProvider === "rpcs3" && canCheckEmulator,
      gameKey,
      isModalVisible
    );
  const retryRetroArchExecutable = () => {
    retryRetroArchExecutableStatus();
    void refresh().catch(() => undefined);
  };
  const openRetroArchSettings = () => {
    setIsModalVisible(false);
    navigate(RETROARCH_CONFIG_SETTINGS_URL);
  };
  const openRpcs3Settings = () => {
    setIsModalVisible(false);
    navigate(RPCS3_CONFIG_SETTINGS_URL);
  };
  const [rpcs3DiscStatusEntry, setRpcs3DiscStatusEntry] = useState<{
    key: string;
    status: Rpcs3DiscIdentityStatus;
  } | null>(null);
  const rpcs3DiscStatus =
    rpcs3DiscStatusEntry?.key === gameKey ? rpcs3DiscStatusEntry.status : null;
  const refreshRpcs3DiscStatus = useCallback(async () => {
    if (emulatorProvider !== "rpcs3" || !canCheckCloudSaves) return;
    const status = await window.electron.getRpcs3DiscIdentityStatus(
      objectId,
      shop
    );
    setRpcs3DiscStatusEntry({ key: gameKey, status });
  }, [canCheckCloudSaves, emulatorProvider, gameKey, objectId, shop]);
  const [wasOpenedFromLaunchConflict, setWasOpenedFromLaunchConflict] =
    useState(false);
  useEffect(() => {
    void refreshRpcs3DiscStatus().catch(() =>
      setRpcs3DiscStatusEntry({
        key: gameKey,
        status: {
          status: "catalogue-unavailable",
          path: null,
          titleId: null,
        },
      })
    );
  }, [refreshRpcs3DiscStatus, gameKey, isModalVisible, isSyncing]);
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
  const [localBatteryCandidates, setLocalBatteryCandidates] = useState<
    RetroArchLocalBatteryCandidate[]
  >([]);
  const [legacyBatteryCandidates, setLegacyBatteryCandidates] = useState<
    RetroArchLegacyBatteryCandidate[]
  >([]);
  const [pendingRpcs3ProfileId, setPendingRpcs3ProfileId] = useState<
    string | null
  >(null);
  const [isBindingRpcs3Profile, setIsBindingRpcs3Profile] = useState(false);
  const [isBindingEmulatorDestination, setIsBindingEmulatorDestination] =
    useState(false);
  const activeGameKey = useRef(gameKey);
  const gamePageSyncInFlight = useRef(false);

  activeGameKey.current = gameKey;

  const showSyncError = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : error;
      if (
        emulatorProvider === "retroarch" &&
        isRetroArchExecutableError(error)
      ) {
        retryRetroArchExecutableStatus();
        return true;
      }
      if (emulatorProvider === "retroarch" && typeof message === "string") {
        if (message.includes("cloud_save_retroarch_battery_local_conflict")) {
          void window.electron
            .getRetroArchLocalBatteryCandidates(objectId, shop)
            .then((candidates) => {
              if (activeGameKey.current !== gameKey) return;
              if (candidates.length === 0) {
                setHasSyncError(true);
                return;
              }
              setLocalBatteryCandidates(candidates);
              setIsModalVisible(true);
            })
            .catch(() => setHasSyncError(true));
          return true;
        }
        if (message.includes("cloud_save_retroarch_legacy_battery_conflict")) {
          void window.electron
            .getRetroArchLegacyBatteryCandidates(objectId, shop)
            .then((candidates) => {
              if (activeGameKey.current !== gameKey) return;
              if (candidates.length === 0) {
                setHasSyncError(true);
                return;
              }
              setLegacyBatteryCandidates(candidates);
              setIsModalVisible(true);
            })
            .catch(() => setHasSyncError(true));
          return true;
        }
      }
      if (
        typeof message === "string" &&
        message.includes("cloud_save_rpcs3_profile_binding_required")
      ) {
        setIsModalVisible(true);
        showWarningToast(t("cloud_save_v2_rpcs3_profile_title"), {
          message: fileDetails?.rpcs3Profile?.localProfileId
            ? t("cloud_save_v2_rpcs3_profile_description", {
                localProfileId: fileDetails.rpcs3Profile.localProfileId,
              })
            : t("cloud_save_v2_rpcs3_profile_choose"),
        });
        return true;
      }
      const errorKind = getCloudSaveSyncErrorKind(error);

      if (errorKind === "restore-metadata") {
        showErrorToast(t("cloud_save_v2_restore_metadata_failed_title"), {
          message: t("cloud_save_v2_restore_metadata_failed_description"),
        });
        return true;
      }

      if (errorKind !== "generic") {
        showErrorToast(
          t(
            errorKind === "snapshot-too-large"
              ? "cloud_save_v2_snapshot_too_large_title"
              : "cloud_save_v2_too_many_files_title"
          ),
          {
            message: t(
              errorKind === "snapshot-too-large"
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
    [
      fileDetails?.rpcs3Profile?.localProfileId,
      emulatorProvider,
      gameKey,
      objectId,
      retryRetroArchExecutableStatus,
      shop,
      showErrorToast,
      showWarningToast,
      t,
    ]
  );

  useEffect(() => {
    setIsModalVisible(false);
    setLocalBatteryCandidates([]);
    setLegacyBatteryCandidates([]);
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
    setPendingRpcs3ProfileId(null);
    setIsBindingRpcs3Profile(false);
    setIsBindingEmulatorDestination(false);
    gamePageSyncInFlight.current = false;
  }, [gameKey]);

  useEffect(() => {
    const kind = searchParams.get("openCloudSaveBatteryConflict");
    if (
      emulatorProvider !== "retroarch" ||
      (kind !== "local" && kind !== "legacy")
    )
      return;
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("openCloudSaveBatteryConflict");
    setSearchParams(nextSearchParams, { replace: true });
    setIsModalVisible(true);
    showSyncError(
      new Error(
        kind === "local"
          ? "cloud_save_retroarch_battery_local_conflict"
          : "cloud_save_retroarch_legacy_battery_conflict"
      )
    );
  }, [emulatorProvider, searchParams, setSearchParams, showSyncError]);

  useEffect(() => {
    if (!eligible || searchParams.get("openCloudSaveProfileBinding") !== "1") {
      return;
    }
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("openCloudSaveProfileBinding");
    setSearchParams(nextSearchParams, { replace: true });
    setIsModalVisible(true);
  }, [eligible, searchParams, setSearchParams]);

  useEffect(() => {
    if (!eligible || searchParams.get("openCloudSaveConflict") !== "1") {
      return;
    }

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("openCloudSaveConflict");
    setSearchParams(nextSearchParams, { replace: true });
    setWasOpenedFromLaunchConflict(true);
    setIsModalVisible(true);
  }, [eligible, searchParams, setSearchParams]);

  useEffect(() => {
    if (!eligible || searchParams.get("openCloudSavePathApproval") !== "1") {
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
  }, [
    eligible,
    objectId,
    searchParams,
    setSearchParams,
    shop,
    showErrorToast,
    t,
  ]);

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
        const isKnownError = showSyncError(event.errorCode);
        setHasSyncError(!isKnownError);
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
      !enableGamePageSync ||
      (emulatorProvider === "retroarch" && isModalVisible) ||
      customPathApproval !== null ||
      isBindingEmulatorDestination ||
      searchParams.get("openCloudSavePathApproval") === "1" ||
      !shouldSyncCloudSaveOnGamePage({
        overview,
        shop,
        platform,
        canUseCloudSaves,
        hasExecutablePath,
        retroArchExecutableStatus,
        isGameRunning,
        isSyncing,
        isInFlight: gamePageSyncInFlight.current,
      })
    ) {
      return;
    }

    const requestedGame = gameKey;
    gamePageSyncInFlight.current = true;

    void globalThis.window.electron
      .syncCloudSaveOnGamePage(objectId, shop)
      .catch((error) => {
        if (activeGameKey.current !== requestedGame) return;
        const isKnownError = showSyncError(error);
        setHasSyncError(!isKnownError);
      })
      .finally(() => {
        if (activeGameKey.current === requestedGame) {
          gamePageSyncInFlight.current = false;
        }
      });
  }, [
    canUseCloudSaves,
    customPathApproval,
    enableGamePageSync,
    emulatorProvider,
    gameKey,
    hasExecutablePath,
    isGameRunning,
    isModalVisible,
    isBindingEmulatorDestination,
    isSyncing,
    objectId,
    overview,
    platform,
    retroArchExecutableStatus,
    searchParams,
    shop,
    showSyncError,
  ]);

  const runCloudSaveOperation = useCallback(
    async (resolution?: CloudSaveConflictResolution) => {
      if (
        emulatorProvider === "retroarch" &&
        retroArchExecutableStatus !== "ready"
      )
        return false;
      if (
        isGameRunning ||
        isSyncing ||
        !hasExecutablePath ||
        !canUseCloudSaves ||
        !eligible
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
          const isKnownError = showSyncError(error);
          setHasSyncError(!isKnownError);
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
      emulatorProvider,
      gameKey,
      eligible,
      hasExecutablePath,
      isGameRunning,
      isSyncing,
      objectId,
      refresh,
      retroArchExecutableStatus,
      shop,
      showSyncError,
    ]
  );

  const handleAutomaticSyncChange = async (enabled: boolean) => {
    if (
      enabled &&
      emulatorProvider === "retroarch" &&
      retroArchExecutableStatus !== "ready"
    ) {
      throw new Error("cloud_save_retroarch_not_configured");
    }
    if (!canUseCloudSaves) {
      throw new Error("Cloud Saves require an active subscription");
    }

    try {
      await globalThis.window.electron.setCloudSaveAutomaticSyncEnabled(
        objectId,
        shop,
        enabled
      );
      await refresh();
    } catch (error) {
      showErrorToast(t("cloud_save_v2_toggle_error_title"), {
        message: t("cloud_save_v2_toggle_error_description"),
      });
      throw error;
    }
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

  const handleConfirmRpcs3Profile = async () => {
    const cloudProfileId = pendingRpcs3ProfileId;
    if (!cloudProfileId || isBindingRpcs3Profile) return;
    setIsBindingRpcs3Profile(true);
    try {
      await globalThis.window.electron.bindRpcs3CloudSaveProfile(
        objectId,
        shop,
        cloudProfileId
      );
      await Promise.all([refreshFileDetails(), refresh()]);
      setPendingRpcs3ProfileId(null);
      showSuccessToast(t("cloud_save_v2_rpcs3_profile_linked"));
    } catch {
      showErrorToast(t("cloud_save_v2_rpcs3_profile_error_title"), {
        message: t("cloud_save_v2_rpcs3_profile_error_description"),
      });
    } finally {
      setIsBindingRpcs3Profile(false);
    }
  };

  const handleSelectEmulatorDestination = async (
    rawPath: string,
    kind: "save" | "state"
  ) => {
    if (isBindingEmulatorDestination || isSyncing || isGameRunning) return;
    setIsBindingEmulatorDestination(true);
    try {
      const result = await globalThis.window.electron.selectEmulatorDestination(
        objectId,
        shop,
        rawPath,
        kind
      );
      if (result.canceled) return;
      await refreshFileDetails();
      const completed = await runCloudSaveOperation();
      if (completed) {
        await refreshFileDetails();
        showSuccessToast(t("cloud_save_v2_emulator_destination_linked"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      showErrorToast(t("cloud_save_v2_emulator_destination_error_title"), {
        message: t(
          message.includes("config_mismatch") ||
            message.includes("config_unavailable")
            ? "cloud_save_v2_emulator_destination_config_error"
            : "cloud_save_v2_emulator_destination_error"
        ),
      });
    } finally {
      setIsBindingEmulatorDestination(false);
    }
  };

  const handleRemoveEmulatorDestination = async (
    rawPath: string,
    kind: "save" | "state"
  ) => {
    if (isBindingEmulatorDestination || isSyncing || isGameRunning) return;
    setIsBindingEmulatorDestination(true);
    try {
      await globalThis.window.electron.removeEmulatorDestination(
        objectId,
        shop,
        rawPath,
        kind
      );
      await Promise.all([refreshFileDetails(), refresh()]);
      showSuccessToast(t("cloud_save_v2_emulator_destination_removed"));
    } catch {
      showErrorToast(t("cloud_save_v2_emulator_destination_error_title"), {
        message: t("cloud_save_v2_emulator_destination_error"),
      });
    } finally {
      setIsBindingEmulatorDestination(false);
    }
  };

  const customPathErrorKey = getCustomPathApprovalErrorKey(
    customPathApprovalError,
    customPathApproval?.purpose
  );
  const customPathErrorMessage = customPathErrorKey
    ? t(customPathErrorKey)
    : undefined;
  const hasError = hasRefreshError || hasSyncError;
  let errorMessageKey:
    | "cloud_save_v2_sync_error"
    | "cloud_save_v2_load_error"
    | null = null;
  if (hasSyncError) {
    errorMessageKey = "cloud_save_v2_sync_error";
  } else if (hasRefreshError) {
    errorMessageKey = "cloud_save_v2_load_error";
  }
  if (
    emulatorProvider === "rpcs3" &&
    rpcs3ConfigStatus &&
    rpcs3ConfigStatus !== "ready"
  ) {
    errorMessageKey = null;
  }
  if (
    emulatorProvider === "rpcs3" &&
    (refreshErrorCode === "cloud_save_rpcs3_save_wrong_game" ||
      (rpcs3DiscStatus && rpcs3DiscStatus.status !== "ready"))
  ) {
    errorMessageKey = null;
  }
  if (
    emulatorProvider === "retroarch" &&
    isRetroArchSetupBlocked(retroArchExecutableStatus)
  ) {
    errorMessageKey = null;
  }
  const panelProps = {
    overview,
    isLoading: isRefreshing,
    isSyncing,
    isGameRunning,
    hasExecutablePath,
    requiresRom: emulatorProvider === "retroarch",
    requiresDisc: emulatorProvider === "rpcs3",
    retroArchExecutableStatus,
    onRetryRetroArchExecutable: retryRetroArchExecutable,
    onConfigureRetroArch: openRetroArchSettings,
    rpcs3ConfigStatus,
    onRetryRpcs3Config: retryRpcs3Config,
    onConfigureRpcs3: openRpcs3Settings,
    rpcs3DiscStatus,
    rpcs3IdentityError: refreshErrorCode === "cloud_save_rpcs3_save_wrong_game",
    onRetryRpcs3Disc: () =>
      void Promise.all([refreshRpcs3DiscStatus(), refresh()]),
    hasError,
    errorMessageKey,
    progress,
    onSync: () => void runCloudSaveOperation(),
    onAutomaticSyncChange: handleAutomaticSyncChange,
    onResolveConflict: setPendingResolution,
    rpcs3Profile: fileDetails?.rpcs3Profile,
    onSelectRpcs3Profile: setPendingRpcs3ProfileId,
    isBindingRpcs3Profile,
    emulatorDestinations: fileDetails?.emulatorDestinations,
    onSelectEmulatorDestination: (rawPath: string, kind: "save" | "state") =>
      void handleSelectEmulatorDestination(rawPath, kind),
    onRemoveEmulatorDestination: (rawPath: string, kind: "save" | "state") =>
      void handleRemoveEmulatorDestination(rawPath, kind),
    isBindingEmulatorDestination,
  } satisfies Omit<
    BigPictureCloudSavePanelProps,
    "showLaunchConflictWarning" | "onSelectExecutable"
  >;
  const value: BigPictureCloudSaveContextValue = {
    overview,
    isRefreshing,
    isSyncing,
    hasError,
    progress,
    canUseCloudSaves,
    hasExecutablePath,
    panelProps,
    openManager: () => {
      if (!canUseCloudSaves) {
        showErrorToast(
          t(
            userDetails
              ? "cloud_save_v2_subscription_required_title"
              : "cloud_save_v2_sign_in_required_title"
          ),
          {
            message: t(
              userDetails
                ? "cloud_save_v2_subscription_required_description"
                : "cloud_save_v2_sign_in_required_description"
            ),
          }
        );
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
        {...panelProps}
        visible={isModalVisible}
        showLaunchConflictWarning={wasOpenedFromLaunchConflict}
        onSelectExecutable={() => {
          setIsModalVisible(false);
          onSelectExecutable();
        }}
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

      <BigPictureRpcs3ProfileModal
        localProfileId={fileDetails?.rpcs3Profile?.localProfileId ?? null}
        cloudProfileId={pendingRpcs3ProfileId}
        isBinding={isBindingRpcs3Profile}
        onClose={() => {
          if (!isBindingRpcs3Profile) setPendingRpcs3ProfileId(null);
        }}
        onConfirm={() => void handleConfirmRpcs3Profile()}
      />

      <BigPictureRetroArchBatteryModal
        choices={
          localBatteryCandidates.length > 0
            ? localBatteryCandidates.map((item) => ({
                key: item.romPath,
                label: item.romPath,
              }))
            : legacyBatteryCandidates.map((item, index) => ({
                key: item.rawPath,
                label: t("cloud_save_v2_legacy_battery_candidate", {
                  index: index + 1,
                  date: new Date(item.files[0].lastModifiedAt).toLocaleString(),
                  hash: (
                    item.files.find(
                      (file) => file.relativePath === "battery.srm"
                    ) ?? item.files[0]
                  ).hash.slice(0, 8),
                }),
              }))
        }
        legacy={legacyBatteryCandidates.length > 0}
        isBusy={isSyncing || isGameRunning}
        onClose={() => {
          setLocalBatteryCandidates([]);
          setLegacyBatteryCandidates([]);
        }}
        onSelect={(key) => {
          const local = localBatteryCandidates.find(
            (item) => item.romPath === key
          );
          const selection = local
            ? window.electron.selectRetroArchLocalBattery(
                objectId,
                shop,
                local.romPath,
                local.signature
              )
            : window.electron.selectRetroArchLegacyBattery(objectId, shop, key);
          void selection
            .then(() => {
              setLocalBatteryCandidates([]);
              setLegacyBatteryCandidates([]);
              void runCloudSaveOperation();
            })
            .catch((error) => {
              setHasSyncError(true);
              showSyncError(error);
            });
        }}
      />
    </bigPictureCloudSaveContext.Provider>
  );
}
