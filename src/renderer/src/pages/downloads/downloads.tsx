import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button, TextField } from "@renderer/components";
import { formatDownloadProgress, steamUrlBuilder } from "@renderer/helpers";
import { useDownload, useLibrary } from "@renderer/hooks";
import type { Game } from "@types";

import { useEffect, useMemo, useRef, useState } from "react";
import { BinaryNotFoundModal } from "../shared-modals/binary-not-found-modal";
import * as styles from "./downloads.css";
import { DeleteModal } from "./delete-modal";
import { formatBytes } from "@renderer/utils";
import { Downloader, GameStatus, GameStatusHelper } from "@shared";

export function Downloads() {
  const { library, updateLibrary } = useLibrary();

  const { t } = useTranslation("downloads");

  const navigate = useNavigate();

  const gameToBeDeleted = useRef<number | null>(null);

  const [filteredLibrary, setFilteredLibrary] = useState<Game[]>([]);
  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const {
    game: gameDownloading,
    progress,
    numPeers,
    numSeeds,
    pauseDownload,
    resumeDownload,
    removeGameFromLibrary,
    cancelDownload,
    deleteGame,
    isGameDeleting,
  } = useDownload();

  const libraryWithDownloadedGamesOnly = useMemo(() => {
    return library.filter((game) => game.status);
  }, [library]);

  useEffect(() => {
    setFilteredLibrary(libraryWithDownloadedGamesOnly);
  }, [libraryWithDownloadedGamesOnly]);

  const openGameInstaller = (gameId: number) =>
    window.electron.openGameInstaller(gameId).then((isBinaryInPath) => {
      if (!isBinaryInPath) setShowBinaryNotFoundModal(true);
      updateLibrary();
    });

  const getFinalDownloadSize = (game: Game) => {
    const isGameDownloading = gameDownloading?.id === game?.id;

    if (!game) return "N/A";
    if (game.fileSize) return formatBytes(game.fileSize);

    if (gameDownloading?.fileSize && isGameDownloading)
      return formatBytes(gameDownloading.fileSize);

    return game.repack?.fileSize ?? "N/A";
  };

  const getGameInfo = (game: Game) => {
    const isGameDownloading = gameDownloading?.id === game?.id;
    const finalDownloadSize = getFinalDownloadSize(game);

    if (isGameDeleting(game?.id)) {
      return <p>{t("deleting")}</p>;
    }

    if (isGameDownloading) {
      return (
        <>
          <p>{progress}</p>

          {gameDownloading?.status &&
          gameDownloading?.status !== GameStatus.Downloading ? (
            <p>{t(gameDownloading?.status)}</p>
          ) : (
            <>
              <p>
                {formatBytes(gameDownloading?.bytesDownloaded)} /{" "}
                {finalDownloadSize}
              </p>
              {game.downloader === Downloader.Torrent && (
                <p>
                  {numPeers} peers / {numSeeds} seeds
                </p>
              )}
            </>
          )}
        </>
      );
    }

    if (GameStatusHelper.isReady(game?.status)) {
      return (
        <>
          <p>{game?.repack.title}</p>
          <p>{t("completed")}</p>
        </>
      );
    }
    if (game?.status === GameStatus.Cancelled) return <p>{t("cancelled")}</p>;
    if (game?.status === GameStatus.DownloadingMetadata)
      return <p>{t("starting_download")}</p>;

    if (game?.status === GameStatus.Paused) {
      return (
        <>
          <p>{formatDownloadProgress(game.progress)}</p>
          <p>{t("paused")}</p>
        </>
      );
    }

    return null;
  };

  const openDeleteModal = (gameId: number) => {
    gameToBeDeleted.current = gameId;
    setShowDeleteModal(true);
  };

  const getGameActions = (game: Game) => {
    const isGameDownloading = gameDownloading?.id === game?.id;

    const deleting = isGameDeleting(game.id);

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

    if (game?.status === GameStatus.Paused) {
      return (
        <>
          <Button onClick={() => resumeDownload(game.id)} theme="outline">
            {t("resume")}
          </Button>
          <Button onClick={() => cancelDownload(game.id)} theme="outline">
            {t("cancel")}
          </Button>
        </>
      );
    }

    if (GameStatusHelper.isReady(game?.status)) {
      return (
        <>
          <Button
            onClick={() => openGameInstaller(game.id)}
            theme="outline"
            disabled={deleting}
          >
            {t("install")}
          </Button>

          <Button onClick={() => openDeleteModal(game.id)} theme="outline">
            {t("delete")}
          </Button>
        </>
      );
    }

    if (game?.status === GameStatus.DownloadingMetadata) {
      return (
        <Button onClick={() => cancelDownload(game.id)} theme="outline">
          {t("cancel")}
        </Button>
      );
    }

    return (
      <>
        <Button
          onClick={() => navigate(`/game/${game.shop}/${game.objectID}`)}
          theme="outline"
          disabled={deleting}
        >
          {t("download_again")}
        </Button>

        <Button
          onClick={() => removeGameFromLibrary(game.id)}
          theme="outline"
          disabled={deleting}
        >
          {t("remove_from_list")}
        </Button>
      </>
    );
  };

  const handleFilter: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    setFilteredLibrary(
      libraryWithDownloadedGamesOnly.filter((game) =>
        game.title
          .toLowerCase()
          .includes(event.target.value.toLocaleLowerCase())
      )
    );
  };

  const handleDeleteGame = () => {
    if (gameToBeDeleted.current) {
      deleteGame(gameToBeDeleted.current).then(updateLibrary);
    }
  };

  return (
    <section className={styles.downloadsContainer}>
      <BinaryNotFoundModal
        visible={showBinaryNotFoundModal}
        onClose={() => setShowBinaryNotFoundModal(false)}
      />
      <DeleteModal
        visible={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        deleteGame={handleDeleteGame}
      />

      <TextField placeholder={t("filter")} onChange={handleFilter} />

      <ul className={styles.downloads}>
        {filteredLibrary.map((game) => {
          return (
            <li
              key={game.id}
              className={styles.download({
                cancelled: game.status === GameStatus.Cancelled,
              })}
            >
              <img
                src={steamUrlBuilder.library(game.objectID)}
                className={styles.downloadCover}
                alt={game.title}
              />
              <div className={styles.downloadRightContent}>
                <div className={styles.downloadDetails}>
                  <button
                    type="button"
                    className={styles.downloadTitle}
                    onClick={() =>
                      navigate(`/game/${game.shop}/${game.objectID}`)
                    }
                  >
                    {game.title}
                  </button>

                  {getGameInfo(game)}
                </div>

                <div className={styles.downloadActions}>
                  {getGameActions(game)}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
