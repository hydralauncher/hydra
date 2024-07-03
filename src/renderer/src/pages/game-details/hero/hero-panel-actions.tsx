import { GearIcon, PlayIcon, PlusCircleIcon } from "@primer/octicons-react";
import { Button } from "@renderer/components";
import { useDownload, useLibrary } from "@renderer/hooks";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import * as styles from "./hero-panel-actions.css";

import { gameDetailsContext } from "@renderer/context";

export function HeroPanelActions() {
  const [toggleLibraryGameDisabled, setToggleLibraryGameDisabled] =
    useState(false);

  const { isGameDeleting } = useDownload();

  const {
    game,
    repacks,
    isGameRunning,
    objectID,
    gameTitle,
    setShowGameOptionsModal,
    setShowRepacksModal,
    updateGame,
    selectGameExecutable,
  } = useContext(gameDetailsContext);

  const { updateLibrary } = useLibrary();

  const { t } = useTranslation("game_details");

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
      onClick={() => setShowRepacksModal(true)}
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
      <div className={styles.actions}>
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
            <PlayIcon />
            {t("play")}
          </Button>
        )}

        <div className={styles.separator} />

        <Button
          onClick={() => setShowGameOptionsModal(true)}
          theme="outline"
          disabled={deleting}
          className={styles.heroPanelAction}
        >
          <GearIcon />
          {t("options")}
        </Button>
      </div>
    );
  }

  return addGameToLibraryButton;
}
