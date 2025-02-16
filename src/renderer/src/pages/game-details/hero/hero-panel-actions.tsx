import {
  DownloadIcon,
  GearIcon,
  HeartFillIcon,
  HeartIcon,
  PlayIcon,
  PlusCircleIcon,
} from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { useAppSelector, useDownload, useLibrary } from "@renderer/hooks";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { gameDetailsContext } from "@renderer/context";
import "./hero-panel-actions.scss";

export function HeroPanelActions() {
  const [toggleLibraryGameDisabled, setToggleLibraryGameDisabled] =
    useState(false);

  const { isGameDeleting } = useDownload();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const {
    game,
    repacks,
    isGameRunning,
    shop,
    objectId,
    gameTitle,
    setShowGameOptionsModal,
    setShowRepacksModal,
    updateGame,
    selectGameExecutable,
  } = useContext(gameDetailsContext);

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game?.download?.status === "active" && lastPacket?.gameId === game?.id;

  const { updateLibrary } = useLibrary();

  const { t } = useTranslation("game_details");

  const addGameToLibrary = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      await window.electron.addGameToLibrary(shop, objectId!, gameTitle);

      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const addGameToFavorites = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (!objectId) throw new Error("objectId is required");
      await window.electron.addGameToFavorites(shop, objectId);
      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const removeGameFromFavorites = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (!objectId) throw new Error("objectId is required");
      await window.electron.removeGameFromFavorites(shop, objectId);
      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const openGame = async () => {
    if (game) {
      if (game.executablePath) {
        window.electron.openGame(
          game.shop,
          game.objectId,
          game.executablePath,
          game.launchOptions
        );
        return;
      }

      let gameInstallerFolderIfExists

      if (game && game.folderName) {
        let downloadsPath = await window.electron.getDefaultDownloadsPath();
        if (userPreferences?.downloadsPath)
          downloadsPath = userPreferences.downloadsPath;

        const folderSeparator =
          window.electron.platform == "win32" ? "\\" : "/";

        gameInstallerFolderIfExists =
          (game.downloadPath ?? downloadsPath) +
          folderSeparator +
          game.folderName!;
      }

      const gameExecutablePath = await selectGameExecutable(
        gameInstallerFolderIfExists
      );
      if (gameExecutablePath)
        window.electron.openGame(
          game.shop,
          game.objectId,
          gameExecutablePath,
          game.launchOptions
        );
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
    if (isGameRunning) {
      return (
        <Button
          onClick={closeGame}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action"
        >
          {t("close")}
        </Button>
      );
    }

    if (game?.executablePath) {
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
        disabled={isGameDownloading || !repacks.length}
        className="hero-panel-actions__action"
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
        {gameActionButton()}
        <div className="hero-panel-actions__separator" />
        <Button
          onClick={game.favorite ? removeGameFromFavorites : addGameToFavorites}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action"
        >
          {game.favorite ? <HeartFillIcon /> : <HeartIcon />}
        </Button>


        <Button
          onClick={() => setShowGameOptionsModal(true)}
          theme="outline"
          disabled={deleting}
          className="hero-panel-actions__action"
        >
          <GearIcon />
          {t("options")}
        </Button>
      </div>
    );
  }

  return addGameToLibraryButton;
}
