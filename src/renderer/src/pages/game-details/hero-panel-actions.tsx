import { NoEntryIcon, PlusCircleIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import { useDownload, useLibrary } from "@renderer/hooks";
import type { Game, ShopDetails } from "@types";
import { useState } from "react";
import { useTranslation } from "react-i18next";

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
    return window.electron
      .showOpenDialog({
        properties: ["openFile"],
        filters: [
          {
            name: "Game executable",
            extensions: window.electron.platform === "win32" ? ["exe"] : [],
          },
        ],
      })
      .then(({ filePaths }) => {
        if (filePaths && filePaths.length > 0) {
          return filePaths[0];
        }
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
          gameDetails.objectID,
          gameDetails.name,
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
    window.electron.openGameInstaller(game.id).then((isBinaryInPath) => {
      if (!isBinaryInPath) openBinaryNotFoundModal();
      updateLibrary();
    });
  };

  const openGame = async () => {
    if (game.executablePath) {
      window.electron.openGame(game.id, game.executablePath);
      return;
    }

    if (game?.executablePath) {
      window.electron.openGame(game.id, game.executablePath);
      return;
    }

    const gameExecutablePath = await selectGameExecutable();
    window.electron.openGame(game.id, gameExecutablePath);
  };

  const closeGame = () => window.electron.closeGame(game.id);

  const deleting = isGameDeleting(game?.id);

  const toggleGameOnLibraryButton = (
    <Button
      theme="outline"
      disabled={!gameDetails || toggleLibraryGameDisabled}
      onClick={toggleGameOnLibrary}
    >
      {game ? <NoEntryIcon /> : <PlusCircleIcon />}
      {game ? t("remove_from_library") : t("add_to_library")}
    </Button>
  );

  if (isGameDownloading) {
    return (
      <>
        <Button onClick={() => pauseDownload(game.id)} theme="outline">
          {t("pause")}
        </Button>
        <Button onClick={() => cancelDownload(game.id)} theme="outline">
          {t("cancel")}
        </Button>
      </>
    );
  }

  if (game?.status === "paused") {
    return (
      <>
        <Button onClick={() => resumeDownload(game.id)} theme="outline">
          {t("resume")}
        </Button>
        <Button
          onClick={() => cancelDownload(game.id).then(getGame)}
          theme="outline"
        >
          {t("cancel")}
        </Button>
      </>
    );
  }

  if (game?.status === "seeding" || (game && !game.status)) {
    return (
      <>
        {game?.status === "seeding" ? (
          <Button
            onClick={openGameInstaller}
            theme="outline"
            disabled={deleting || isGamePlaying}
          >
            {t("install")}
          </Button>
        ) : (
          toggleGameOnLibraryButton
        )}

        {isGamePlaying ? (
          <Button onClick={closeGame} theme="outline" disabled={deleting}>
            {t("close")}
          </Button>
        ) : (
          <Button
            onClick={openGame}
            theme="outline"
            disabled={deleting || isGamePlaying}
          >
            {t("play")}
          </Button>
        )}
      </>
    );
  }

  if (game?.status === "cancelled") {
    return (
      <>
        <Button onClick={openRepacksModal} theme="outline" disabled={deleting}>
          {t("open_download_options")}
        </Button>
        <Button
          onClick={() => removeGameFromLibrary(game.id).then(getGame)}
          theme="outline"
          disabled={deleting}
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
        <Button onClick={openRepacksModal} theme="outline">
          {t("open_download_options")}
        </Button>
      </>
    );
  }

  return toggleGameOnLibraryButton;
}
