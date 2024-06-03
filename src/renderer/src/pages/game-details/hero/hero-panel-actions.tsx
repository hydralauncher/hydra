import { NoEntryIcon, PlusCircleIcon } from "@primer/octicons-react";

import { BinaryNotFoundModal } from "../../shared-modals/binary-not-found-modal";

import { Button } from "@renderer/components";
import { useAppSelector, useDownload, useLibrary } from "@renderer/hooks";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";

import * as styles from "./hero-panel-actions.css";
import { gameDetailsContext } from "../game-details.context";
import { Downloader } from "@shared";

export function HeroPanelActions() {
  const [toggleLibraryGameDisabled, setToggleLibraryGameDisabled] =
    useState(false);
  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState(false);

  const {
    resumeDownload,
    pauseDownload,
    cancelDownload,
    removeGameFromLibrary,
    isGameDeleting,
  } = useDownload();

  const {
    game,
    repacks,
    isGameRunning,
    objectID,
    gameTitle,
    openRepacksModal,
    updateGame,
  } = useContext(gameDetailsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateLibrary } = useLibrary();

  const { t } = useTranslation("game_details");

  const getDownloadsPath = async () => {
    if (userPreferences?.downloadsPath) return userPreferences.downloadsPath;
    return window.electron.getDefaultDownloadsPath();
  };

  const selectGameExecutable = async () => {
    const downloadsPath = await getDownloadsPath();

    return window.electron
      .showOpenDialog({
        properties: ["openFile"],
        defaultPath: downloadsPath,
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
          objectID!,
          gameTitle,
          "steam",
          gameExecutablePath
        );
      }

      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const openGameInstaller = () => {
    if (game) {
      window.electron.openGameInstaller(game.id).then((isBinaryInPath) => {
        if (!isBinaryInPath) setShowBinaryNotFoundModal(true);
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

  if (game?.status === "active" && game?.progress !== 1) {
    return (
      <>
        <Button
          onClick={() => pauseDownload(game.id).then(updateGame)}
          theme="outline"
          className={styles.heroPanelAction}
        >
          {t("pause")}
        </Button>
        <Button
          onClick={() => cancelDownload(game.id).then(updateGame)}
          theme="outline"
          className={styles.heroPanelAction}
        >
          {t("cancel")}
        </Button>
      </>
    );
  }

  if (game?.status === "paused") {
    return (
      <>
        <Button
          onClick={() => resumeDownload(game.id).then(updateGame)}
          theme="outline"
          className={styles.heroPanelAction}
          disabled={
            game.downloader === Downloader.RealDebrid &&
            !userPreferences?.realDebridApiToken
          }
        >
          {t("resume")}
        </Button>
        <Button
          onClick={() => cancelDownload(game.id).then(updateGame)}
          theme="outline"
          className={styles.heroPanelAction}
        >
          {t("cancel")}
        </Button>
      </>
    );
  }

  if (game?.status === "removed") {
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
          onClick={() => removeGameFromLibrary(game.id).then(updateGame)}
          theme="outline"
          disabled={deleting}
          className={styles.heroPanelAction}
        >
          {t("remove_from_list")}
        </Button>
      </>
    );
  }

  if (repacks.length && !game) {
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

  if (game) {
    return (
      <>
        {game?.progress === 1 ? (
          <>
            <BinaryNotFoundModal
              visible={showBinaryNotFoundModal}
              onClose={() => setShowBinaryNotFoundModal(false)}
            />

            <Button
              onClick={openGameInstaller}
              theme="outline"
              disabled={deleting || isGameRunning}
              className={styles.heroPanelAction}
            >
              {t("install")}
            </Button>
          </>
        ) : (
          toggleGameOnLibraryButton
        )}

        {isGameRunning ? (
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
            disabled={deleting || isGameRunning}
            className={styles.heroPanelAction}
          >
            {t("play")}
          </Button>
        )}
      </>
    );
  }

  return toggleGameOnLibraryButton;
}
