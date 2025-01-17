import { useNavigate } from "react-router-dom";

import type { LibraryGame, SeedingStatus } from "@types";

import { Badge, Button } from "@renderer/components";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
} from "@renderer/helpers";

import { Downloader, formatBytes, steamUrlBuilder } from "@shared";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { useAppSelector, useDownload } from "@renderer/hooks";

import "./download-group.scss";
import "../../scss/_variables.scss";

import { useTranslation } from "react-i18next";
import { useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@renderer/components/dropdown-menu/dropdown-menu";
import {
  ColumnsIcon,
  DownloadIcon,
  LinkIcon,
  PlayIcon,
  ThreeBarsIcon,
  TrashIcon,
  UnlinkIcon,
  XCircleIcon,
} from "@primer/octicons-react";

export interface DownloadGroupProps {
  library: LibraryGame[];
  title: string;
  openDeleteGameModal: (gameId: number) => void;
  openGameInstaller: (gameId: number) => void;
  seedingStatus: SeedingStatus[];
}

export function DownloadGroup({
  library,
  title,
  openDeleteGameModal,
  openGameInstaller,
  seedingStatus,
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
    pauseSeeding,
    resumeSeeding,
  } = useDownload();

  const getFinalDownloadSize = (game: LibraryGame) => {
    const isGameDownloading = lastPacket?.game.id === game.id;

    if (game.fileSize) return formatBytes(game.fileSize);

    if (lastPacket?.game.fileSize && isGameDownloading)
      return formatBytes(lastPacket?.game.fileSize);

    return "N/A";
  };

  const seedingMap = useMemo(() => {
    const map = new Map<number, SeedingStatus>();

    seedingStatus.forEach((seed) => {
      map.set(seed.gameId, seed);
    });

    return map;
  }, [seedingStatus]);

  const getGameInfo = (game: LibraryGame) => {
    const isGameDownloading = lastPacket?.game.id === game.id;
    const finalDownloadSize = getFinalDownloadSize(game);
    const seedingStatus = seedingMap.get(game.id);

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
      const uploadSpeed = formatBytes(seedingStatus?.uploadSpeed ?? 0);

      return game.status === "seeding" &&
        game.downloader === Downloader.Torrent ? (
        <>
          <p>{t("seeding")}</p>
          {uploadSpeed && <p>{uploadSpeed}/s</p>}
        </>
      ) : (
        <p>{t("completed")}</p>
      );
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

  const getGameActions = (game: LibraryGame): DropdownMenuItem[] => {
    const isGameDownloading = lastPacket?.game.id === game.id;

    const deleting = isGameDeleting(game.id);

    if (game.progress === 1) {
      return [
        {
          label: t("install"),
          disabled: deleting,
          onClick: () => openGameInstaller(game.id),
          icon: <DownloadIcon />,
        },
        {
          label: t("stop_seeding"),
          disabled: deleting,
          icon: <UnlinkIcon />,
          show:
            game.status === "seeding" && game.downloader === Downloader.Torrent,
          onClick: () => pauseSeeding(game.id),
        },
        {
          label: t("resume_seeding"),
          disabled: deleting,
          icon: <LinkIcon />,
          show:
            game.status !== "seeding" && game.downloader === Downloader.Torrent,
          onClick: () => resumeSeeding(game.id),
        },
        {
          label: t("delete"),
          disabled: deleting,
          icon: <TrashIcon />,
          onClick: () => openDeleteGameModal(game.id),
        },
      ];
    }

    if (isGameDownloading || game.status === "active") {
      return [
        {
          label: t("pause"),
          onClick: () => pauseDownload(game.id),
          icon: <ColumnsIcon />,
        },
        {
          label: t("cancel"),
          onClick: () => cancelDownload(game.id),
          icon: <XCircleIcon />,
        },
      ];
    }

    return [
      {
        label: t("resume"),
        disabled:
          game.downloader === Downloader.RealDebrid &&
          !userPreferences?.realDebridApiToken,
        onClick: () => resumeDownload(game.id),
        icon: <PlayIcon />,
      },
      {
        label: t("cancel"),
        onClick: () => cancelDownload(game.id),
        icon: <XCircleIcon />,
      },
    ];
  };

  if (!library.length) return null;

  return (
    <div className="download-group">
      <div className="download-group__downloads-group"
      >
        <h2>{title}</h2>

        <div
          style={{
            flex: 1,
            backgroundColor: "var(--border-color)",
            height: "1px",
          }}
        />
        <h3 style={{ fontWeight: "400" }}>{library.length}</h3>
      </div>

      <ul className="download-group__downloads">
        {library.map((game) => {
          return (
            <li
              key={game.id}
              className="download-group__download"
              style={{ position: "relative" }}
            >
              <div className="download-group__cover">
                <div className="download-group__cover-backdrop">
                  <img
                    src={steamUrlBuilder.library(game.objectID)}
                    className="download-group__cover-image"
                    alt={game.title}
                  />

                  <div className="download-group__cover-content">
                    <Badge>{DOWNLOADER_NAME[game.downloader]}</Badge>
                  </div>
                </div>
              </div>
              <div className="download-group__right-content">
                <div className="download-group__details">
                  <div className="download-group__title-wrapper">
                    <button
                      type="button"
                      className="download-group__title"
                      onClick={() =>
                        navigate(
                          buildGameDetailsPath({
                            ...game,
                            objectId: game.objectID,
                          })
                        )
                      }
                    >
                      {game.title}
                    </button>
                  </div>

                  {getGameInfo(game)}
                </div>

                {getGameActions(game) !== null && (
                  <DropdownMenu
                    align="end"
                    items={getGameActions(game)}
                    sideOffset={-75}
                  >
                    <Button
                      style={{
                        position: "absolute",
                        top: "12px",
                        right: "12px",
                        borderRadius: "50%",
                        border: "none",
                        padding: "8px",
                        minHeight: "unset",
                      }}
                      theme="outline"
                    >
                      <ThreeBarsIcon />
                    </Button>
                  </DropdownMenu>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
