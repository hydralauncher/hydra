import {
  DownloadIcon,
  GearIcon,
  HeartFillIcon,
  HeartIcon,
  DashIcon,
  PinIcon,
  PinSlashIcon,
  PlayIcon,
  PlusCircleIcon,
  FileDirectoryIcon,
  TrashIcon,
} from "@primer/octicons-react";
import { Button, ConfirmationModal } from "@renderer/components";
import {
  useDownload,
  useLibrary,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { gameDetailsContext } from "@renderer/context";

import { usePriorityDownload } from "./use-priority-download";
import SteamIcon from "@renderer/assets/launcher-icons/steam.svg?react";

import "./hero-panel-actions.scss";

function useHeroPanelActions() {
  const [toggleLibraryGameDisabled, setToggleLibraryGameDisabled] =
    useState(false);
  const [showUninstallModal, setShowUninstallModal] = useState(false);
  const [executableExists, setExecutableExists] = useState<boolean | null>(
    null
  );

  const { isGameDeleting, removeGameInstaller, pauseSeeding } = useDownload();
  const { userDetails } = useUserDetails();

  const {
    game,
    repacks,
    isGameRunning,
    shop,
    objectId,
    gameTitle,
    setShowGameOptionsModal,
    setGameOptionsInitialCategory,
    setShowRepacksModal,
    updateGame,
    selectGameExecutable,
  } = useContext(gameDetailsContext);

  const {
    isAutoDownloadEnabled,
    priorityRepack,
    buttonLabel: downloadButtonLabel,
    triggerDownload: handlePriorityDownload,
  } = usePriorityDownload({
    shop,
    objectId,
    gameTitle,
    repacks,
    updateGame,
    setShowRepacksModal,
  });

  const onDownloadClick = () => {
    if (isAutoDownloadEnabled && priorityRepack) {
      handlePriorityDownload();
    } else {
      setShowRepacksModal(true);
    }
  };

  const { lastPacket } = useDownload();

  const isGameDownloading =
    game?.download?.status === "active" && lastPacket?.gameId === game?.id;

  const { updateLibrary } = useLibrary();

  const { showSuccessToast } = useToast();

  const { t } = useTranslation("game_details");

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

  useEffect(() => {
    setExecutableExists(null);
    if (!game?.executablePath) return;
    window.electron
      .checkFileExists(game.executablePath)
      .then(setExecutableExists);
  }, [game?.executablePath]);

  const locateExecutable = async () => {
    const path = await selectGameExecutable();
    if (path) {
      await window.electron.updateExecutablePath(shop, objectId!, path);
      updateGame();
    }
  };

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

  const toggleGameFavorite = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (game?.favorite && objectId) {
        await window.electron
          .removeGameFromFavorites(shop, objectId)
          .then(() => {
            showSuccessToast(t("game_removed_from_favorites"));
          });
      } else {
        if (!objectId) return;

        await window.electron.addGameToFavorites(shop, objectId).then(() => {
          showSuccessToast(t("game_added_to_favorites"));
        });
      }

      updateLibrary();
      updateGame();
    } finally {
      setToggleLibraryGameDisabled(false);
    }
  };

  const toggleGamePinned = async () => {
    setToggleLibraryGameDisabled(true);

    try {
      if (game?.isPinned && objectId) {
        await window.electron.toggleGamePin(shop, objectId, false).then(() => {
          showSuccessToast(t("game_removed_from_pinned"));
        });
      } else {
        if (!objectId) return;

        await window.electron.toggleGamePin(shop, objectId, true).then(() => {
          showSuccessToast(t("game_added_to_pinned"));
        });
      }

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

      const gameExecutablePath = await selectGameExecutable();
      if (gameExecutablePath)
        window.electron.openGame(
          game.shop,
          game.objectId,
          gameExecutablePath,
          game.launchOptions
        );
    }
  };

  const deleting = game ? isGameDeleting(game?.id) : false;

  const removeGameFromLibraryButton = game ? (
    <>
      <ConfirmationModal
        visible={showUninstallModal}
        title={t("uninstall_modal_title", { defaultValue: "Desinstalar jogo" })}
        descriptionText={t("uninstall_modal_description", {
          defaultValue:
            "Tem certeza que deseja desinstalar e remover os arquivos deste jogo?",
        })}
        confirmButtonLabel={t("uninstall", { defaultValue: "Desinstalar" })}
        cancelButtonLabel={t("cancel", { defaultValue: "Cancelar" })}
        onConfirm={async () => {
          setShowUninstallModal(false);
          setToggleLibraryGameDisabled(true);
          try {
            await pauseSeeding(game.shop, game.objectId);
            await removeGameInstaller(game.shop, game.objectId);
          } finally {
            setToggleLibraryGameDisabled(false);
          }
        }}
        onClose={() => setShowUninstallModal(false)}
      />
      <Button
        theme="primary"
        disabled={toggleLibraryGameDisabled}
        onClick={async () => {
          const isInstalled = Boolean(
            (game?.executablePath && executableExists !== false) ||
              game?.download?.progress === 1
          );

          if (isInstalled) {
            setShowUninstallModal(true);
          } else {
            setToggleLibraryGameDisabled(true);
            try {
              await window.electron.removeGameFromLibrary(
                game.shop,
                game.objectId
              );
              updateLibrary();
              updateGame();
            } finally {
              setToggleLibraryGameDisabled(false);
            }
          }
        }}
      >
        {(game?.executablePath && executableExists !== false) ||
        game?.download?.progress === 1 ? (
          <TrashIcon />
        ) : (
          <DashIcon />
        )}
      </Button>
    </>
  ) : null;

  const addGameToLibraryButton = (
    <Button
      theme="primary"
      disabled={toggleLibraryGameDisabled}
      onClick={addGameToLibrary}
      title={t("add_to_library")}
    >
      <PlusCircleIcon />
    </Button>
  );

  const showDownloadOptionsButton = (
    <Button
      onClick={onDownloadClick}
      theme="primary"
      disabled={deleting}
      style={{ minWidth: 200 }}
    >
      <DownloadIcon />
      {downloadButtonLabel}
    </Button>
  );

  const installViaSteamButton =
    shop === "steam" ? (
      <Button
        theme="primary"
        onClick={() =>
          window.electron.openExternal(`steam://store/${objectId}`)
        }
        disabled={deleting || isGameDownloading}
        title={t("install_via_steam_tooltip", {
          defaultValue: "Baixar e instalar via cliente original Steam",
        })}
      >
        <SteamIcon style={{ width: 14, height: 14, fill: "currentColor" }} />
      </Button>
    ) : null;

  const locateButton = (
    <Button
      theme="primary"
      onClick={locateExecutable}
      title={t("locate_executable", { defaultValue: "Localizar executável" })}
    >
      <FileDirectoryIcon />
    </Button>
  );

  const gameActionButton = () => {
    if (isGameRunning) {
      return (
        <Button
          theme="primary"
          disabled
          style={{ minWidth: 200, opacity: 0.5, pointerEvents: "none" }}
        >
          <PlayIcon />
          {t("playing", { defaultValue: "Jogando" })}
        </Button>
      );
    }

    if (game?.executablePath && executableExists === true) {
      return (
        <Button
          onClick={openGame}
          theme="primary"
          disabled={deleting || isGameRunning}
          style={{ minWidth: 200 }}
        >
          <PlayIcon />
          {t("play")}
        </Button>
      );
    }

    return (
      <>
        <Button
          onClick={onDownloadClick}
          theme="primary"
          disabled={isGameDownloading}
          style={{ minWidth: 200 }}
        >
          <DownloadIcon />
          {downloadButtonLabel}
        </Button>
        {game?.executablePath && executableExists === false && locateButton}
      </>
    );
  };

  if (repacks.length && !game) {
    return {
      primary: (
        <>
          {showDownloadOptionsButton}
          {installViaSteamButton}
          {addGameToLibraryButton}
        </>
      ),
      secondary: null,
    };
  }

  if (game) {
    return {
      primary: (
        <>
          {gameActionButton()}
          <Button
            onClick={toggleGameFavorite}
            theme="primary"
            disabled={deleting}
          >
            {game.favorite ? <HeartFillIcon /> : <HeartIcon />}
          </Button>
          {shop === "steam" && installViaSteamButton}
          {removeGameFromLibraryButton}
        </>
      ),
      secondary: (
        <>
          {userDetails && game.shop !== "custom" && (
            <Button
              onClick={toggleGamePinned}
              theme="primary"
              disabled={deleting}
            >
              {game.isPinned ? <PinSlashIcon /> : <PinIcon />}
            </Button>
          )}

          <Button
            onClick={() => {
              setGameOptionsInitialCategory("general");
              setShowGameOptionsModal(true);
            }}
            theme="primary"
            disabled={deleting}
          >
            <GearIcon />
          </Button>
        </>
      ),
    };
  }

  return {
    primary: (
      <>
        {installViaSteamButton}
        {addGameToLibraryButton}
      </>
    ),
    secondary: null,
  };
}

export function HeroPanelPrimaryActions() {
  const { primary } = useHeroPanelActions();
  return <div className="hero-panel-actions__container">{primary}</div>;
}

export function HeroPanelSecondaryActions() {
  const { secondary } = useHeroPanelActions();
  return <>{secondary}</>;
}
