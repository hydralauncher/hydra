import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { Button, TextField } from "@renderer/components";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
  steamUrlBuilder,
} from "@renderer/helpers";
import { useAppSelector, useDownload, useLibrary } from "@renderer/hooks";
import type { LibraryGame } from "@types";

import { useEffect, useMemo, useRef, useState } from "react";
import { BinaryNotFoundModal } from "../shared-modals/binary-not-found-modal";
import * as styles from "./downloads.css";
import { DeleteGameModal } from "./delete-game-modal";
import { Downloader, formatBytes } from "@shared";
import { DOWNLOADER_NAME } from "@renderer/constants";

export function Downloads() {
  const { library, updateLibrary } = useLibrary();

  const { t } = useTranslation("downloads");

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const navigate = useNavigate();

  const gameToBeDeleted = useRef<number | null>(null);

  const [filteredLibrary, setFilteredLibrary] = useState<LibraryGame[]>([]);
  const [showBinaryNotFoundModal, setShowBinaryNotFoundModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const {
    lastPacket,
    progress,
    pauseDownload,
    resumeDownload,
    removeGameFromLibrary,
    cancelDownload,
    removeGameInstaller,
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

  const getFinalDownloadSize = (game: LibraryGame) => {
    const isGameDownloading = lastPacket?.game.id === game.id;

    if (game.fileSize) return formatBytes(game.fileSize);

    if (lastPacket?.game.fileSize && isGameDownloading)
      return formatBytes(lastPacket?.game.fileSize);

    return "N/A";
  };

  const getGameInfo = (game: LibraryGame) => {
    const isGameDownloading = lastPacket?.game.id === game.id;
    const finalDownloadSize = getFinalDownloadSize(game);

    if (isGameDeleting(game.id)) {
      return <p>{t("deleting")}</p>;
    }

    if (isGameDownloading) {
      return (
        <>
          <p>{progress}</p>

          <p>
            {formatBytes(lastPacket?.game.bytesDownloaded)} /{" "}
            {finalDownloadSize}
          </p>

          {game.downloader === Downloader.Torrent && (
            <small>
              {lastPacket?.numPeers} peers / {lastPacket?.numSeeds} seeds
            </small>
          )}
        </>
      );
    }

    if (game.progress === 1) {
      return <p>{t("completed")}</p>;
    }

    if (game.status === "paused") {
      return (
        <>
          <p>{formatDownloadProgress(game.progress)}</p>
          <p>{t("paused")}</p>
        </>
      );
    }

    if (game.status === "active") {
      return (
        <>
          <p>{formatDownloadProgress(game.progress)}</p>

          <p>
            {formatBytes(game.bytesDownloaded)} / {finalDownloadSize}
          </p>
        </>
      );
    }

    return <p>{t(game.status)}</p>;
  };

  const openDeleteModal = (gameId: number) => {
    gameToBeDeleted.current = gameId;
    setShowDeleteModal(true);
  };

  const getGameActions = (game: LibraryGame) => {
    const isGameDownloading = lastPacket?.game.id === game.id;

    const deleting = isGameDeleting(game.id);

    if (game.progress === 1) {
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

    if (isGameDownloading || game.status === "active") {
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

    if (game.status === "paused") {
      return (
        <>
          <Button
            onClick={() => resumeDownload(game.id)}
            theme="outline"
            disabled={
              game.downloader === Downloader.RealDebrid &&
              !userPreferences?.realDebridApiToken
            }
          >
            {t("resume")}
          </Button>
          <Button onClick={() => cancelDownload(game.id)} theme="outline">
            {t("cancel")}
          </Button>
        </>
      );
    }

    return (
      <>
        <Button
          onClick={() => navigate(buildGameDetailsPath(game))}
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

  const handleDeleteGame = async () => {
    if (gameToBeDeleted.current)
      await removeGameInstaller(gameToBeDeleted.current);
  };

  return (
    <section className={styles.downloadsContainer}>
      <BinaryNotFoundModal
        visible={showBinaryNotFoundModal}
        onClose={() => setShowBinaryNotFoundModal(false)}
      />

      <DeleteGameModal
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
                cancelled: game.status === "removed",
              })}
            >
              <div className={styles.downloadCover}>
                <div className={styles.downloadCoverBackdrop}>
                  <img
                    src={steamUrlBuilder.library(game.objectID)}
                    className={styles.downloadCoverImage}
                    alt={game.title}
                  />

                  <div className={styles.downloadCoverContent}>
                    <small className={styles.downloaderName}>
                      {DOWNLOADER_NAME[game.downloader]}
                    </small>
                  </div>
                </div>
              </div>
              <div className={styles.downloadRightContent}>
                <div className={styles.downloadDetails}>
                  <div className={styles.downloadTitleWrapper}>
                    <button
                      type="button"
                      className={styles.downloadTitle}
                      onClick={() => navigate(buildGameDetailsPath(game))}
                    >
                      {game.title}
                    </button>
                  </div>

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
