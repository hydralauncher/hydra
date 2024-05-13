import { GameStatus, GameStatusHelper } from "@shared";
import { NoEntryIcon, PlusCircleIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useDownload, useLibrary } from "@renderer/hooks";
import type { Game, GameRepack } from "@types";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import * as styles from "./hero-panel-actions.css";

export interface HeroPanelActionsProps {
  game: Game | null;
  repacks: GameRepack[];
  isGamePlaying: boolean;
  isGameDownloading: boolean;
  objectID: string;
  title: string;
  openRepacksModal: () => void;
  openBinaryNotFoundModal: () => void;
  getGame: () => void;
}

export function HeroPanelActions({
  game,
  isGamePlaying,
  isGameDownloading,
  repacks,
  objectID,
  title,
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
    return window.electron
      .showOpenDialog({
        properties: ["openFile"],
        filters: [
          {
            name: "Game executable",
            extensions: ["exe"],
          },
        ],
      })
      .then(({ filePaths }) => {
        if (filePaths && filePaths.length > 0) {
          return filePaths[0];
        }

        return null;
      });
  };

  const toggleGameOnLibrary = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (game) {
        await removeGameFromLibrary(game.id);
      } else {
        const gameExecutablePath = await selectGameExecutable();

        await window.electron.addGameToLibrary(
          objectID,
          title,
          "steam",
          gameExecutablePath
        );
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
      disabled={toggleLibraryGameDisabled}
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

  if (repacks.length) {
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
