import { GearIcon, PlusCircleIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { useAppSelector, useDownload, useLibrary } from "@renderer/hooks";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import * as styles from "./hero-panel-actions.css";
import { gameDetailsContext } from "../game-details.context";
import { GameOptionsModal } from "../modals/game-options-modal";

export function HeroPanelActions() {
  const [toggleLibraryGameDisabled, setToggleLibraryGameDisabled] =
    useState(false);
  const [showGameOptionsModal, setShowGameOptionsModal] = useState(false);

  const { isGameDeleting } = useDownload();

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

  const addGameToLibrary = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      await window.electron.addGameToLibrary(objectID!, gameTitle, "steam");

      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const openGame = async () => {
    if (game) {
      if (game.executablePath) {
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

  const addGameToLibraryButton = (
    <Button
      theme="outline"
      disabled={toggleLibraryGameDisabled}
      onClick={addGameToLibrary}
      className={styles.heroPanelAction}
    >
      <PlusCircleIcon />
      {t("add_to_library")}
    </Button>
  );

  const showDownloadOptionsButton = (
    <Button
      onClick={openRepacksModal}
      theme="outline"
      disabled={deleting}
      className={styles.heroPanelAction}
    >
      {t("open_download_options")}
    </Button>
  );

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
      <>
        <GameOptionsModal
          visible={showGameOptionsModal}
          game={game}
          onClose={() => {
            setShowGameOptionsModal(false);
          }}
          selectGameExecutable={selectGameExecutable}
        />
        <Button
          onClick={() => {
            setShowGameOptionsModal(true);
          }}
          theme="outline"
          disabled={deleting}
          className={styles.heroPanelAction}
        >
          <GearIcon />
        </Button>

        <div className={styles.separator} />

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

  return addGameToLibraryButton;
}
