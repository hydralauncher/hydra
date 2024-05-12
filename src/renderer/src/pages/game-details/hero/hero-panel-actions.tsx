import { GameStatus, GameStatusHelper } from "@shared";
import { NoEntryIcon, PlusCircleIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useDownload, useLibrary } from "@renderer/hooks";
import type { Game, ShopDetails } from "@types";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import * as styles from "./hero-panel-actions.css";

export interface HeroPanelActionsProps {
  game: Game | null;
  gameDetails: ShopDetails | null;
  isGamePlaying: boolean;
  isGameDownloading: boolean;
  openRepacksModal: () => void;
  openBinaryNotFoundModal: () => void;
  getGame: () => void;
}

export function HeroPanelActions({
  game,
  gameDetails,
  isGamePlaying,
  isGameDownloading,
  openRepacksModal,
  openBinaryNotFoundModal,
  getGame,
}: HeroPanelActionsProps) {
  const [toggleLibraryGameDisabled, setToggleLibraryGameDisabled] =
    useState(false);

  const {
    resumeDownload,
    pauseDownload,
    cancelDownload,
    removeGameFromLibrary,
    isGameDeleting,
  } = useDownload();

  const { updateLibrary } = useLibrary();

  const { t } = useTranslation("game_details");

  const selectGameExecutable = async () => {
    const { canceled, filePaths } = await window.electron.showOpenDialog({
      title: t("game_executable_selection.title"),
      properties: ["openFile"],
      filters: [
        {
          name: window.electron.platform === "win32" ? t("game_executable_selection.executable_files") : t("game_executable_selection.all_files"),
          extensions: window.electron.platform === "win32" ? ["exe"] : ["*"],
        },
      ],
    });

    return canceled ? null : filePaths[0];
  };

  const toggleGameOnLibrary = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (game) {
        await removeGameFromLibrary(game.id);
      } else if (gameDetails) {
        const gameExecutablePath = await selectGameExecutable();

        if (gameExecutablePath) {
          await window.electron.addGameToLibrary(
            gameDetails.objectID,
            gameDetails.name,
            "steam",
            gameExecutablePath
          );
        }
      }

      updateLibrary();
      getGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const openGameInstaller = () => {
    if (game) {
      window.electron.openGameInstaller(game.id).then((isBinaryInPath) => {
        if (!isBinaryInPath) openBinaryNotFoundModal();
        updateLibrary();
      });
    }
  };

  const openGame = async () => {
    if (game) {
      if (game.executablePath) {
        window.electron.openGame(game.id, game.executablePath);
        return;
      }

      if (game?.executablePath) {
        window.electron.openGame(game.id, game.executablePath);
        return;
      }

      const gameExecutablePath = await selectGameExecutable();
      if (gameExecutablePath)
        window.electron.openGame(game.id, gameExecutablePath);
    }
  };

  const closeGame = () => {
    if (game) window.electron.closeGame(game.id);
  };

  const deleting = game ? isGameDeleting(game?.id) : false;

  const toggleGameOnLibraryButton = (
    <Button
      theme="outline"
      disabled={!gameDetails || toggleLibraryGameDisabled}
      onClick={toggleGameOnLibrary}
      className={styles.heroPanelAction}
    >
      {game ? <NoEntryIcon /> : <PlusCircleIcon />}
      {game ? t("remove_from_library") : t("add_to_library")}
    </Button>
  );

  if (game && isGameDownloading) {
    return (
      <>
        <Button
          onClick={() => pauseDownload(game.id)}
          theme="outline"
          className={styles.heroPanelAction}
        >
          {t("pause")}
        </Button>
        <Button
          onClick={() => cancelDownload(game.id)}
          theme="outline"
          className={styles.heroPanelAction}
        >
          {t("cancel")}
        </Button>
      </>
    );
  }

  if (game?.status === GameStatus.Paused) {
    return (
      <>
        <Button
          onClick={() => resumeDownload(game.id)}
          theme="outline"
          className={styles.heroPanelAction}
        >
          {t("resume")}
        </Button>
        <Button
          onClick={() => cancelDownload(game.id).then(getGame)}
          theme="outline"
          className={styles.heroPanelAction}
        >
          {t("cancel")}
        </Button>
      </>
    );
  }

  if (
    GameStatusHelper.isReady(game?.status ?? null) ||
    (game && !game.status)
  ) {
    return (
      <>
        {GameStatusHelper.isReady(game?.status ?? null) ? (
          <Button
            onClick={openGameInstaller}
            theme="outline"
            disabled={deleting || isGamePlaying}
            className={styles.heroPanelAction}
          >
            {t("install")}
          </Button>
        ) : (
          toggleGameOnLibraryButton
        )}

        {isGamePlaying ? (
          <Button
            onClick={closeGame}
            theme="outline"
            disabled={deleting}
            className={styles.heroPanelAction}
          >
            {t("close")}
          </Button>
        ) : (
          <Button
            onClick={openGame}
            theme="outline"
            disabled={deleting || isGamePlaying}
            className={styles.heroPanelAction}
          >
            {t("play")}
          </Button>
        )}
      </>
    );
  }

  if (game?.status === GameStatus.Cancelled) {
    return (
      <>
        <Button
          onClick={openRepacksModal}
          theme="outline"
          disabled={deleting}
          className={styles.heroPanelAction}
        >
          {t("open_download_options")}
        </Button>
        <Button
          onClick={() => removeGameFromLibrary(game.id).then(getGame)}
          theme="outline"
          disabled={deleting}
          className={styles.heroPanelAction}
        >
          {t("remove_from_list")}
        </Button>
      </>
    );
  }

  if (gameDetails && gameDetails.repacks.length) {
    return (
      <>
        {toggleGameOnLibraryButton}
        <Button
          onClick={openRepacksModal}
          theme="outline"
          className={styles.heroPanelAction}
        >
          {t("open_download_options")}
        </Button>
      </>
    );
  }

  return toggleGameOnLibraryButton;
}
