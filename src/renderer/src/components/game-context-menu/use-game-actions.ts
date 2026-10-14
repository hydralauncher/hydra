import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  useDownload,
  useGameCollections,
  useLibrary,
  useLibraryGamePresentation,
  useToast,
} from "@renderer/hooks";
import { useNavigate, useLocation } from "react-router-dom";
import {
  buildGameDetailsPath,
  handleClassicsLaunchError,
} from "@renderer/helpers";
import { logger } from "@renderer/logger";
import { useGameOptionsModal } from "@renderer/context/game-options-modal/game-options-modal.context";
import type { GameSettingsCategoryId } from "@renderer/pages/game-details/modals/game-options-modal/types";
import type { GameContextMenuGame } from "./game-context-menu.types";
import { applyLibraryGroupAction, isLibraryGameDownloading } from "@shared";

export function useGameActions(requestedGame: GameContextMenuGame) {
  const { t } = useTranslation("game_details");
  const { showSuccessToast, showErrorToast } = useToast();
  const { library, updateLibrary } = useLibrary();
  const group = useLibraryGamePresentation(requestedGame);
  const game = group?.operationalGame ?? requestedGame;
  const downloadGame = group?.downloadGame ?? game;
  const members = group?.members ?? [game];
  const { loadCollections } = useGameCollections();
  const navigate = useNavigate();
  const location = useLocation();
  const { openGameOptionsModal } = useGameOptionsModal();
  const { removeGameInstaller, removeGameFromLibrary, isGameDeleting } =
    useDownload();

  const [creatingSteamShortcut, setCreatingSteamShortcut] = useState(false);
  const [creatingShortcut, setCreatingShortcut] = useState(false);
  const [isGameRunning, setIsGameRunning] = useState(false);
  const [rpcs3ConfirmPending, setRpcs3ConfirmPending] = useState<{
    discPath?: string;
  } | null>(null);

  const isClassics = game.shop === "launchbox";
  const hasClassicsDiscs = (game.discs?.length ?? 0) > 0;
  const canPlay =
    Boolean(game.executablePath) || (isClassics && hasClassicsDiscs);
  const isDeleting = isGameDeleting(game.objectId);
  const isDownloadDeleting = isGameDeleting(downloadGame.objectId);
  const isGameDownloading = isLibraryGameDownloading(downloadGame);
  const hasRepacks = true;
  useEffect(() => {
    const unsubscribe = window.electron.onGamesRunning((gamesIds) => {
      const updatedIsGameRunning =
        !!game?.id &&
        !!gamesIds.find((gameRunning) => gameRunning.id == game.id);

      setIsGameRunning(updatedIsGameRunning);
    });

    return () => {
      unsubscribe();
    };
  }, [game?.id]);

  const launchClassicsAttempt = useCallback(
    async (discPath: string | undefined, force?: boolean): Promise<void> => {
      try {
        await globalThis.electron.openClassicsGame(
          game.shop,
          game.objectId,
          discPath,
          force
        );
      } catch (error) {
        const shouldLog = handleClassicsLaunchError(error, {
          t,
          showErrorToast,
          showSuccessToast,
          navigate,
          onEmulatorAlreadyRunning: () => setRpcs3ConfirmPending({ discPath }),
        });
        if (shouldLog) {
          logger.error("Failed to start classics game", error);
        }
      }
    },
    [game.shop, game.objectId, navigate, showErrorToast, showSuccessToast, t]
  );

  const handleConfirmRpcs3Launch = useCallback(async () => {
    const pending = rpcs3ConfirmPending;
    setRpcs3ConfirmPending(null);
    if (pending) await launchClassicsAttempt(pending.discPath, true);
  }, [rpcs3ConfirmPending, launchClassicsAttempt]);

  const handleCancelRpcs3Launch = useCallback(() => {
    setRpcs3ConfirmPending(null);
  }, []);

  const handlePlayGame = async () => {
    const detailsPath = buildGameDetailsPath({
      ...game,
      objectId: game.objectId,
    });

    if (!canPlay) {
      if (location.pathname !== detailsPath) {
        navigate(detailsPath, { state: { openRepacks: true } });
      }
      globalThis.dispatchEvent(
        new CustomEvent("hydra:openRepacks", {
          detail: { objectId: game.objectId },
        })
      );
      return;
    }

    if (isClassics) {
      const multipleDiscs = (game.discs?.length ?? 0) > 1;
      const needsModal =
        multipleDiscs && !(game.dontAskDiscSelection && game.selectedDiscPath);

      if (needsModal) {
        navigate(detailsPath, { state: { openDiscSelection: true } });
        globalThis.dispatchEvent(
          new CustomEvent("hydra:openDiscSelection", {
            detail: { objectId: game.objectId },
          })
        );
        return;
      }

      await launchClassicsAttempt(game.selectedDiscPath ?? undefined);
      return;
    }

    try {
      await window.electron.openGame(
        game.shop,
        game.objectId,
        game.executablePath!,
        game.launchOptions
      );
    } catch (error) {
      showErrorToast("Failed to start game");
      logger.error("Failed to start game", error);
    }
  };

  const handleCloseGame = async () => {
    try {
      await window.electron.closeGame(game.shop, game.objectId);
    } catch (error) {
      showErrorToast("Failed to close game");
      logger.error("Failed to close game", error);
    }
  };

  const handleToggleFavorite = async (
    isFavorite = Boolean(group?.favorite ?? game.favorite)
  ) => {
    try {
      if (isFavorite) {
        await applyLibraryGroupAction(members, (member) =>
          window.electron.removeGameFromFavorites(member.shop, member.objectId)
        );
        showSuccessToast(t("game_removed_from_favorites"));
      } else {
        await applyLibraryGroupAction(members, (member) =>
          window.electron.addGameToFavorites(member.shop, member.objectId)
        );
        showSuccessToast(t("game_added_to_favorites"));
      }
      try {
        window.dispatchEvent(
          new CustomEvent("hydra:game-favorite-toggled", {
            detail: { shop: game.shop, objectId: game.objectId },
          })
        );
      } catch {
        /* empty */
      }
    } catch (error) {
      showErrorToast(t("failed_update_favorites"));
      logger.error("Failed to toggle favorite", error);
      throw error;
    } finally {
      await updateLibrary();
    }
  };

  const handleCreateShortcut = async () => {
    try {
      setCreatingShortcut(true);

      const locations =
        window.electron.platform === "win32"
          ? (["desktop", "start_menu"] as const)
          : (["desktop"] as const);

      for (const location of locations) {
        const success = await window.electron.createGameShortcut(
          game.shop,
          game.objectId,
          location
        );

        if (!success) {
          throw new Error(t("create_shortcut_error"));
        }
      }

      showSuccessToast(t("create_shortcut_success"));
    } catch (error) {
      showErrorToast(
        t("create_shortcut_error"),
        error instanceof Error ? error.message : undefined
      );
      logger.error("Failed to create shortcut", error);
    } finally {
      setCreatingShortcut(false);
    }
  };

  const handleCreateSteamShortcut = async () => {
    try {
      setCreatingSteamShortcut(true);
      await window.electron.createSteamShortcut(game.shop, game.objectId);

      showSuccessToast(
        t("create_shortcut_success"),
        t("you_might_need_to_restart_steam")
      );
    } catch (error) {
      logger.error("Failed to create Steam shortcut", error);
      showErrorToast(t("create_shortcut_error"));
    } finally {
      setCreatingSteamShortcut(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await window.electron.openGameExecutablePath(game.shop, game.objectId);
    } catch (error) {
      showErrorToast("Failed to open folder");
      logger.error("Failed to open folder", error);
    }
  };

  const handleOpenDownloadOptions = () => {
    const path = buildGameDetailsPath({
      ...game,
      objectId: game.objectId,
    });
    navigate(path, { state: { openRepacks: true } });

    try {
      window.dispatchEvent(
        new CustomEvent("hydra:openRepacks", {
          detail: { objectId: game.objectId },
        })
      );
    } catch (e) {
      void e;
    }
  };

  const handleOpenGameOptions = (initialCategory?: GameSettingsCategoryId) => {
    const libraryGame = library.find(
      (item) => item.objectId === game.objectId && item.shop === game.shop
    );

    if (libraryGame) {
      openGameOptionsModal(libraryGame, initialCategory);
      return;
    }

    const path = buildGameDetailsPath({
      ...game,
      objectId: game.objectId,
    });

    navigate(path, { state: { openGameOptions: true } });

    try {
      window.dispatchEvent(
        new CustomEvent("hydra:openGameOptions", {
          detail: { objectId: game.objectId },
        })
      );
    } catch (e) {
      void e;
    }
  };

  const handleTogglePin = async () => {
    try {
      const isPinned = group?.isPinned ?? game.isPinned;
      await applyLibraryGroupAction(members, (member) =>
        window.electron.toggleGamePin(member.shop, member.objectId, !isPinned)
      );
      if (isPinned) {
        showSuccessToast(t("game_removed_from_pinned"));
      } else {
        showSuccessToast(t("game_added_to_pinned"));
      }
      try {
        window.dispatchEvent(
          new CustomEvent("hydra:game-pin-toggled", {
            detail: { shop: game.shop, objectId: game.objectId },
          })
        );
      } catch {
        /* empty */
      }
    } catch (error) {
      showErrorToast(t("failed_update_pinned"));
      logger.error("Failed to toggle pin", error);
    } finally {
      await updateLibrary();
    }
  };

  const handleOpenDownloadLocation = async () => {
    try {
      await window.electron.openGameInstallerPath(
        downloadGame.shop,
        downloadGame.objectId
      );
    } catch (error) {
      showErrorToast("Failed to open download location");
      logger.error("Failed to open download location", error);
    }
  };

  const handleRemoveFromLibrary = async () => {
    try {
      await applyLibraryGroupAction(members, async (member) => {
        if (member.download?.status === "active") {
          await window.electron.cancelGameDownload(
            member.shop,
            member.objectId
          );
        }
        await removeGameFromLibrary(member.shop, member.objectId);
      });
      showSuccessToast(t("game_removed_from_library"));
      try {
        window.dispatchEvent(
          new CustomEvent("hydra:game-removed-from-library", {
            detail: { shop: game.shop, objectId: game.objectId },
          })
        );
      } catch {
        /* empty */
      }
    } catch (error) {
      showErrorToast(t("failed_remove_from_library"));
      logger.error("Failed to remove from library", error);
    } finally {
      await Promise.all([updateLibrary(), loadCollections()]);
    }
  };

  const handleRemoveFiles = async () => {
    if (
      isLibraryGameDownloading(downloadGame) ||
      isGameDeleting(downloadGame.objectId)
    )
      return;

    try {
      await removeGameInstaller(downloadGame.shop, downloadGame.objectId);
      await updateLibrary();
      showSuccessToast(t("files_removed_success"));
      try {
        window.dispatchEvent(
          new CustomEvent("hydra:game-files-removed", {
            detail: {
              shop: downloadGame.shop,
              objectId: downloadGame.objectId,
            },
          })
        );
      } catch {
        /* empty */
      }
    } catch (error) {
      showErrorToast(t("failed_remove_files"));
      logger.error("Failed to remove files", error);
    }
  };

  return {
    canPlay,
    downloadGame,
    isDeleting,
    isDownloadDeleting,
    isGameDownloading,
    isGameRunning,
    hasRepacks,
    creatingShortcut,
    creatingSteamShortcut,
    rpcs3ConfirmPending,
    handlePlayGame,
    handleCloseGame,
    handleToggleFavorite,
    handleCreateShortcut,
    handleCreateSteamShortcut,
    handleOpenFolder,
    handleOpenDownloadOptions,
    handleOpenDownloadLocation,
    handleTogglePin,
    handleRemoveFromLibrary,
    handleRemoveFiles,
    handleOpenGameOptions,
    handleConfirmRpcs3Launch,
    handleCancelRpcs3Launch,
  };
}
