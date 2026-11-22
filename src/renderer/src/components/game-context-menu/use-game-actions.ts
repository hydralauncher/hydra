import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  useDownload,
  useGameCollections,
  useGameLaunchActions,
  useLibrary,
  useLibraryGamePresentation,
  useToast,
} from "@renderer/hooks";
import { useNavigate } from "react-router-dom";
import { buildGameDetailsPath } from "@renderer/helpers";
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
  const { openGameOptionsModal } = useGameOptionsModal();
  const { removeGameInstaller, removeGameFromLibrary, isGameDeleting } =
    useDownload();

  const [creatingSteamShortcut, setCreatingSteamShortcut] = useState(false);
  const [creatingShortcut, setCreatingShortcut] = useState(false);
  const [isGameRunning, setIsGameRunning] = useState(false);

  const isDeleting = isGameDeleting(game.objectId);
  const isDownloadDeleting = isGameDeleting(downloadGame.objectId);
  const isGameDownloading = isLibraryGameDownloading(downloadGame);
  const hasRepacks = true;
  useEffect(() => {
    const unsubscribe = window.electron.onGamesRunning((gamesIds) => {
      const updatedIsGameRunning =
        !!game?.id && gamesIds.some((gameRunning) => gameRunning.id == game.id);

      setIsGameRunning(updatedIsGameRunning);
    });

    return () => {
      unsubscribe();
    };
  }, [game?.id]);

  const {
    canPlay,
    rpcs3ConfirmPending,
    handlePlayGame,
    handleCloseGame,
    handleConfirmRpcs3Launch,
    handleCancelRpcs3Launch,
  } = useGameLaunchActions(game);

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

  const handleRemoveFiles = async (
    targetGame: GameContextMenuGame = downloadGame,
    deleteSourceArchive = false
  ) => {
    if (
      isLibraryGameDownloading(targetGame) ||
      isGameDeleting(targetGame.objectId)
    )
      return;

    try {
      await removeGameInstaller(targetGame.shop, targetGame.objectId, {
        deleteSourceArchive,
      });
      await updateLibrary();
      showSuccessToast(t("files_removed_success"));
      try {
        window.dispatchEvent(
          new CustomEvent("hydra:game-files-removed", {
            detail: {
              shop: targetGame.shop,
              objectId: targetGame.objectId,
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
