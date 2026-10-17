import {
  DownloadIcon,
  GearIcon,
  HeartFillIcon,
  HeartIcon,
  PinIcon,
  PinSlashIcon,
  PlayIcon,
  PlusCircleIcon,
} from "@primer/octicons-react";
import { Button, ConfirmationModal, Modal } from "@renderer/components";
import type { LibraryGame } from "@types";
import {
  canRetryEpicLaunchWithLocalSaves,
  getEpicLaunchError,
  getEpicManagedError,
} from "@renderer/helpers/epic-managed-error";
import { XCircle } from "lucide-react";
import {
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useCallback, useContext, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { gameDetailsContext } from "@renderer/context";
import {
  canDownloadOnSteam,
  handleClassicsLaunchError,
} from "@renderer/helpers";
import { DiscSelectionModal } from "../modals/disc-selection-modal";
import { EpicCloudSaveConflictModal } from "../modals/epic-cloud-save-conflict-modal";

import "./hero-panel-actions.scss";
import { useEffect } from "react";
import {
  applyLibraryGroupAction,
  isLibraryGameDownloading,
  getOfficialStoreMembers,
} from "@shared";

export function HeroPanelActions() {
  const [toggleLibraryGameDisabled, setToggleLibraryGameDisabled] =
    useState(false);

  const { isGameDeleting } = useDownload();
  const { userDetails } = useUserDetails();

  const {
    game,
    downloadGame,
    presentation,
    repacks,
    isGameRunning,
    shop,
    objectId,
    gameTitle,
    shopDetails,
    setShowGameOptionsModal,
    setGameOptionsInitialCategory,
    setShowRepacksModal,
    updateGame,
    selectGameExecutable,
    isTransferring,
    transferProgress,
  } = useContext(gameDetailsContext);

  const isGameDownloading = isLibraryGameDownloading(downloadGame);

  const { updateLibrary } = useLibrary();

  const { showSuccessToast, showErrorToast } = useToast();

  const navigate = useNavigate();

  const [showDiscSelectionModal, setShowDiscSelectionModal] = useState(false);
  const [localSaveRetry, setLocalSaveRetry] = useState<LibraryGame | null>(
    null
  );
  const [epicSaveConflict, setEpicSaveConflict] = useState<LibraryGame | null>(
    null
  );
  const [canRetryOffline, setCanRetryOffline] = useState(false);
  const [canRetryLocalSaves, setCanRetryLocalSaves] = useState(false);
  const officialMembers = getOfficialStoreMembers(
    presentation?.members ?? (game ? [game] : [])
  );
  const [pendingClassicsLaunch, setPendingClassicsLaunch] = useState<{
    discPath: string | undefined;
  } | null>(null);

  const { t } = useTranslation("game_details");
  const launchGeneration = useRef(0);
  const invalidateLaunch = useCallback(() => {
    launchGeneration.current++;
  }, []);
  useEffect(() => {
    const invalidate = () => {
      invalidateLaunch();
      setLocalSaveRetry(null);
      setEpicSaveConflict(null);
    };
    invalidate();
    const stop = window.electron?.onEpicConnectionChanged?.(invalidate);
    return () => {
      invalidateLaunch();
      stop?.();
    };
  }, [shop, objectId, invalidateLaunch]);

  useEffect(() => {
    const onOpenDiscSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ objectId?: string }>).detail;
      if (!detail?.objectId || detail.objectId === game?.objectId) {
        if (game?.shop === "launchbox" && (game?.discs?.length ?? 0) > 1) {
          setShowDiscSelectionModal(true);
        }
      }
    };
    window.addEventListener(
      "hydra:openDiscSelection",
      onOpenDiscSelection as EventListener
    );
    return () => {
      window.removeEventListener(
        "hydra:openDiscSelection",
        onOpenDiscSelection as EventListener
      );
    };
  }, [game?.objectId, game?.shop, game?.discs?.length]);

  useEffect(() => {
    const onFavoriteToggled = () => {
      updateLibrary();
      updateGame();
    };

    const onGameRemoved = () => {
      updateLibrary();
      updateGame();
    };

    const onFilesRemoved = () => {
      updateLibrary();
      updateGame();
    };

    window.addEventListener(
      "hydra:game-favorite-toggled",
      onFavoriteToggled as EventListener
    );
    window.addEventListener(
      "hydra:game-removed-from-library",
      onGameRemoved as EventListener
    );
    window.addEventListener(
      "hydra:game-files-removed",
      onFilesRemoved as EventListener
    );

    return () => {
      window.removeEventListener(
        "hydra:game-favorite-toggled",
        onFavoriteToggled as EventListener
      );
      window.removeEventListener(
        "hydra:game-removed-from-library",
        onGameRemoved as EventListener
      );
      window.removeEventListener(
        "hydra:game-files-removed",
        onFilesRemoved as EventListener
      );
    };
  }, [updateLibrary, updateGame]);

  const addGameToLibrary = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      await window.electron.addGameToLibrary(
        shop,
        objectId!,
        gameTitle,
        shopDetails?.platform ?? null
      );

      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const toggleGameFavorite = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (!game) return;
      const favorite = presentation?.favorite ?? game.favorite;
      await applyLibraryGroupAction(
        presentation?.members ?? [game],
        (member) =>
          favorite
            ? window.electron.removeGameFromFavorites(
                member.shop,
                member.objectId
              )
            : window.electron.addGameToFavorites(member.shop, member.objectId)
      );
      showSuccessToast(
        t(favorite ? "game_removed_from_favorites" : "game_added_to_favorites")
      );
    } catch {
      showErrorToast(t("failed_update_favorites"));
    } finally {
      await Promise.all([updateLibrary(), updateGame()]);
      setToggleLibraryGameDisabled(false);
    }
  };

  const toggleGamePinned = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (!game) return;
      const pinned = presentation?.isPinned ?? game.isPinned;
      await applyLibraryGroupAction(presentation?.members ?? [game], (member) =>
        window.electron.toggleGamePin(member.shop, member.objectId, !pinned)
      );
      showSuccessToast(
        t(pinned ? "game_removed_from_pinned" : "game_added_to_pinned")
      );
    } catch {
      showErrorToast(t("failed_update_pinned"));
    } finally {
      await Promise.all([updateLibrary(), updateGame()]);
      setToggleLibraryGameDisabled(false);
    }
  };

  const launchClassicsWithErrorHandling = async (
    discPath?: string,
    force?: boolean
  ): Promise<void> => {
    if (!game) return;
    try {
      await window.electron.openClassicsGame(
        game.shop,
        game.objectId,
        discPath,
        force
      );
    } catch (error) {
      handleClassicsLaunchError(error, {
        t,
        showErrorToast,
        showSuccessToast,
        navigate,
        onEmulatorAlreadyRunning: () => setPendingClassicsLaunch({ discPath }),
      });
    }
  };

  const openClassicsGame = async () => {
    if (!game) return;

    const discs = game.discs ?? [];

    if (
      discs.length === 0 ||
      (discs.length === 1 && game.selectedDiscPath !== null)
    ) {
      await launchClassicsWithErrorHandling();
      return;
    }

    if (game.dontAskDiscSelection && game.selectedDiscPath) {
      await launchClassicsWithErrorHandling(game.selectedDiscPath);
      return;
    }

    setShowDiscSelectionModal(true);
  };

  const handleDiscSelectionConfirm = async (
    discPath: string,
    dontAskAgain: boolean
  ) => {
    if (!game) return;
    setShowDiscSelectionModal(false);
    try {
      await window.electron.updateClassicsDisc(game.shop, game.objectId, {
        selectedDiscPath: discPath,
        dontAskDiscSelection: dontAskAgain,
      });
      updateGame();
    } catch (error) {
      // non-fatal; still try to launch
    }
    await launchClassicsWithErrorHandling(discPath);
  };

  const openGame = async () => {
    if (!game) return;

    if (game.shop === "launchbox") {
      await openClassicsGame();
      return;
    }

    if (game.executablePath) {
      await launchMember(game);
      return;
    }

    const gameExecutablePath = await selectGameExecutable();
    if (gameExecutablePath)
      window.electron.openGame(
        game.shop,
        game.objectId,
        gameExecutablePath,
        game.launchOptions
      );
  };
  const launchMember = async (
    member: LibraryGame,
    localOnce = false,
    offline = false
  ) => {
    if (!member.executablePath) return;
    setLocalSaveRetry(null);
    setEpicSaveConflict(null);
    setCanRetryOffline(false);
    setCanRetryLocalSaves(false);
    const generation = launchGeneration.current;
    try {
      await window.electron.openGame(
        member.shop,
        member.objectId,
        member.executablePath,
        member.launchOptions,
        offline
          ? { epicOffline: true }
          : localOnce
            ? { epicSavePolicy: "local-once" }
            : undefined
      );
    } catch (error) {
      if (generation !== launchGeneration.current) return;
      const code =
        member.shop === "epic" ? getEpicLaunchError(error) : undefined;
      if (code === "save-conflict") {
        setEpicSaveConflict(member);
        return;
      }
      const translation = code ? getEpicManagedError(code) : null;
      showErrorToast(
        translation
          ? t(translation.key, { ns: translation.ns })
          : t("epic_launch_failed")
      );
      if (
        member.shop === "epic" &&
        typeof window.electron.getEpicCloudSaveState === "function"
      ) {
        const state = await window.electron
          .getEpicCloudSaveState(member.objectId)
          .catch(() => null);
        if (generation !== launchGeneration.current) return;
        if (state?.status === "conflict") {
          setEpicSaveConflict(member);
          return;
        }
        if (
          canRetryEpicLaunchWithLocalSaves(state) ||
          state?.canRunOffline === true
        ) {
          setLocalSaveRetry(member);
          setCanRetryOffline(state?.canRunOffline === true);
          setCanRetryLocalSaves(canRetryEpicLaunchWithLocalSaves(state));
        }
      }
    }
  };

  const closeGame = () => {
    if (game) window.electron.closeGame(game.shop, game.objectId);
  };

  const deleting = game ? isGameDeleting(game?.id) : false;

  const addGameToLibraryButton = (
    <Button
      theme="outline"
      disabled={toggleLibraryGameDisabled}
      onClick={addGameToLibrary}
      className="hero-panel-actions__action"
    >
      <PlusCircleIcon />
      {t("add_to_library")}
    </Button>
  );

  const showDownloadOptionsButton = (
    <Button
      onClick={() => setShowRepacksModal(true)}
      theme="outline"
      disabled={deleting}
      className="hero-panel-actions__action"
    >
      {t("open_download_options")}
    </Button>
  );

  const gameActionButton = () => {
    if (isTransferring) {
      const percent = Math.round(transferProgress * 100);
      return (
        <Button
          theme="outline"
          className="hero-panel-actions__action"
          onClick={() => {
            setGameOptionsInitialCategory("locations");
            setShowGameOptionsModal(true);
          }}
        >
          Transferring {percent}%
        </Button>
      );
    }

    if (isGameRunning) {
      return (
        <Button
          onClick={closeGame}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action"
        >
          <XCircle size={18} />
          {t("close")}
        </Button>
      );
    }

    const isPlayableClassics =
      game?.shop === "launchbox" && (game?.discs?.length ?? 0) > 0;

    if (game?.executablePath || isPlayableClassics) {
      return (
        <Button
          onClick={openGame}
          theme="outline"
          disabled={deleting || isGameRunning}
          className="hero-panel-actions__action"
        >
          <PlayIcon />
          {t("play")}
        </Button>
      );
    }

    return (
      <Button
        onClick={() => setShowRepacksModal(true)}
        theme="outline"
        disabled={isGameDownloading}
        className={`hero-panel-actions__action ${repacks.length === 0 && !canDownloadOnSteam(officialMembers.steam) && !officialMembers.epic ? "hero-panel-actions__action--disabled" : ""}`}
      >
        <DownloadIcon />
        {t("download")}
      </Button>
    );
  };

  if (repacks.length && !game) {
    return (
      <>
        {addGameToLibraryButton}
        {showDownloadOptionsButton}
      </>
    );
  }

  if (game) {
    return (
      <div className="hero-panel-actions__container">
        <EpicCloudSaveConflictModal
          game={epicSaveConflict}
          isGameRunning={isGameRunning}
          onClose={() => setEpicSaveConflict(null)}
        />
        <Modal
          visible={!!localSaveRetry}
          title={t("epic_play_local_saves")}
          description={t("epic_play_local_saves_description")}
          onClose={() => setLocalSaveRetry(null)}
        >
          <div className="hero-panel-actions__epic-actions">
            {canRetryLocalSaves && (
              <Button
                onClick={() => {
                  if (localSaveRetry) void launchMember(localSaveRetry, true);
                }}
              >
                {t("epic_play_local_saves")}
              </Button>
            )}
            {canRetryOffline && (
              <Button
                theme="outline"
                onClick={() => {
                  if (localSaveRetry)
                    void launchMember(localSaveRetry, false, true);
                }}
              >
                {t("epic_play_offline")}
              </Button>
            )}
          </div>
        </Modal>
        {gameActionButton()}
        <div className="hero-panel-actions__separator" />
        <Button
          onClick={toggleGameFavorite}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action"
        >
          {(presentation?.favorite ?? game.favorite) ? (
            <HeartFillIcon />
          ) : (
            <HeartIcon />
          )}
        </Button>

        {userDetails && game.shop !== "custom" && (
          <Button
            onClick={toggleGamePinned}
            theme="outline"
            disabled={deleting}
            className="hero-panel-actions__action"
          >
            {(presentation?.isPinned ?? game.isPinned) ? (
              <PinSlashIcon />
            ) : (
              <PinIcon />
            )}
          </Button>
        )}

        <Button
          onClick={() => {
            setGameOptionsInitialCategory("general");
            setShowGameOptionsModal(true);
          }}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action"
        >
          <GearIcon />
          {t("options")}
        </Button>

        {game.shop === "launchbox" && (
          <DiscSelectionModal
            visible={showDiscSelectionModal}
            discs={game.discs ?? []}
            defaultDiscPath={game.selectedDiscPath ?? null}
            defaultDontAsk={Boolean(game.dontAskDiscSelection)}
            onClose={() => setShowDiscSelectionModal(false)}
            onConfirm={handleDiscSelectionConfirm}
          />
        )}

        <ConfirmationModal
          visible={pendingClassicsLaunch !== null}
          title={t("rpcs3_already_running_title")}
          descriptionText={t("rpcs3_already_running_description")}
          confirmButtonLabel={t("rpcs3_already_running_confirm")}
          cancelButtonLabel={t("cancel")}
          onClose={() => setPendingClassicsLaunch(null)}
          onConfirm={() => {
            const pending = pendingClassicsLaunch;
            setPendingClassicsLaunch(null);
            if (pending) {
              void launchClassicsWithErrorHandling(pending.discPath, true);
            }
          }}
        />
      </div>
    );
  }

  return addGameToLibraryButton;
}
