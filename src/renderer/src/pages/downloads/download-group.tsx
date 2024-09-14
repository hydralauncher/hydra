import { useNavigate } from "react-router-dom";

import type { LibraryGame } from "@types";

import { Badge, Button } from "@renderer/components";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
} from "@renderer/helpers";

import { Downloader, formatBytes, steamUrlBuilder } from "@shared";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { useAppSelector, useDownload } from "@renderer/hooks";

import * as styles from "./download-group.css";
import { useTranslation } from "react-i18next";
import { SPACING_UNIT, vars } from "@renderer/theme.css";

export interface DownloadGroupProps {
  library: LibraryGame[];
  title: string;
  openDeleteGameModal: (gameId: number) => void;
  openGameInstaller: (gameId: number) => void;
}

export function DownloadGroup({
  library,
  title,
  openDeleteGameModal,
  openGameInstaller,
}: DownloadGroupProps) {
  const navigate = useNavigate();

  const { t } = useTranslation("downloads");

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const {
    lastPacket,
    progress,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    isGameDeleting,
  } = useDownload();

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
      if (lastPacket?.isDownloadingMetadata) {
        return <p>{t("downloading_metadata")}</p>;
      }

      if (lastPacket?.isCheckingFiles) {
        return (
          <>
            <p>{progress}</p>
            <p>{t("checking_files")}</p>
          </>
        );
      }

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
          <p>{t(game.downloadQueue && lastPacket ? "queued" : "paused")}</p>
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

    return <p>{t(game.status as string)}</p>;
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

          <Button onClick={() => openDeleteGameModal(game.id)} theme="outline">
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
  };

  if (!library.length) return null;

  return (
    <div className={styles.downloadGroup}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: `${SPACING_UNIT * 2}px`,
        }}
      >
        <h2>{title}</h2>

        <div
          style={{
            flex: 1,
            backgroundColor: vars.color.border,
            height: "1px",
          }}
        />
        <h3 style={{ fontWeight: "400" }}>{library.length}</h3>
      </div>

      <ul className={styles.downloads}>
        {library.map((game) => {
          return (
            <li key={game.id} className={styles.download}>
              <div className={styles.downloadCover}>
                <div className={styles.downloadCoverBackdrop}>
                  <img
                    src={steamUrlBuilder.library(game.objectID)}
                    className={styles.downloadCoverImage}
                    alt={game.title}
                  />

                  <div className={styles.downloadCoverContent}>
                    <Badge>{DOWNLOADER_NAME[game.downloader]}</Badge>
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
    </div>
  );
}
