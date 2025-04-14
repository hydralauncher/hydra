import { useNavigate } from "react-router-dom";

import type { GameShop, LibraryGame, SeedingStatus } from "@types";
import cn from "classnames";

import { Badge, Button } from "@renderer/components";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
} from "@renderer/helpers";

import { Downloader, formatBytes, steamUrlBuilder } from "@shared";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { useAppSelector, useDownload, useLibrary } from "@renderer/hooks";

import "./download-group.scss";
import { useTranslation } from "react-i18next";
import { useCallback, useMemo } from "react";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@renderer/components/dropdown-menu/dropdown-menu";
import {
  ColumnsIcon,
  DownloadIcon,
  FileDirectoryIcon,
  LinkIcon,
  PlayIcon,
  QuestionIcon,
  ThreeBarsIcon,
  TrashIcon,
  UnlinkIcon,
  XCircleIcon,
} from "@primer/octicons-react";

export interface DownloadGroupProps {
  library: LibraryGame[];
  title: string;
  openDeleteGameModal: (shop: GameShop, objectId: string) => void;
  openGameInstaller: (shop: GameShop, objectId: string) => void;
  seedingStatus: SeedingStatus[];
}

export function DownloadGroup({
  library,
  title,
  openDeleteGameModal,
  openGameInstaller,
  seedingStatus,
}: Readonly<DownloadGroupProps>) {
  const navigate = useNavigate();

  const { t } = useTranslation("downloads");

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateLibrary } = useLibrary();

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
    const download = game.download!;
    const isGameDownloading = lastPacket?.gameId === game.id;

    if (download.fileSize) return formatBytes(download.fileSize);

    if (lastPacket?.download.fileSize && isGameDownloading)
      return formatBytes(lastPacket.download.fileSize);

    return "N/A";
  };

  const seedingMap = useMemo(() => {
    const map = new Map<string, SeedingStatus>();

    seedingStatus.forEach((seed) => {
      map.set(seed.gameId, seed);
    });

    return map;
  }, [seedingStatus]);

  const extractGameDownload = useCallback(
    async (shop: GameShop, objectId: string) => {
      await window.electron.extractGameDownload(shop, objectId);
      updateLibrary();
    },
    [updateLibrary]
  );

  const getGameInfo = (game: LibraryGame) => {
    const download = game.download!;

    const isGameDownloading = lastPacket?.gameId === game.id;
    const finalDownloadSize = getFinalDownloadSize(game);
    const seedingStatus = seedingMap.get(game.id);

    if (download.extracting) {
      return <p>{t("extracting")}</p>;
    }

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
            {formatBytes(lastPacket.download.bytesDownloaded)} /{" "}
            {finalDownloadSize}
          </p>

          {download.downloader === Downloader.Torrent && (
            <small
              className="download-group__details-with-article"
              data-open-article="peers-and-seeds"
            >
              {lastPacket?.numPeers} peers / {lastPacket?.numSeeds} seeds
              <QuestionIcon size={12} />
            </small>
          )}
        </>
      );
    }

    if (download.progress === 1) {
      const uploadSpeed = formatBytes(seedingStatus?.uploadSpeed ?? 0);

      return download.status === "seeding" &&
        download.downloader === Downloader.Torrent ? (
        <>
          <p
            data-open-article="seeding"
            className="download-group__details-with-article"
          >
            {t("seeding")}

            <QuestionIcon />
          </p>
          {uploadSpeed && <p>{uploadSpeed}/s</p>}
        </>
      ) : (
        <p>{t("completed")}</p>
      );
    }

    if (download.status === "paused") {
      return (
        <>
          <p>{formatDownloadProgress(download.progress)}</p>
          <p>{t(download.queued ? "queued" : "paused")}</p>
        </>
      );
    }

    if (download.status === "active") {
      return (
        <>
          <p>{formatDownloadProgress(download.progress)}</p>

          <p>
            {formatBytes(download.bytesDownloaded)} / {finalDownloadSize}
          </p>
        </>
      );
    }

    return <p>{t(download.status as string)}</p>;
  };

  const getGameActions = (game: LibraryGame): DropdownMenuItem[] => {
    const download = lastPacket?.download;
    const isGameDownloading = lastPacket?.gameId === game.id;

    const deleting = isGameDeleting(game.id);

    if (game.download?.progress === 1) {
      return [
        {
          label: t("install"),
          disabled: deleting,
          onClick: () => {
            openGameInstaller(game.shop, game.objectId);
          },
          icon: <DownloadIcon />,
        },
        {
          label: t("extract"),
          disabled: game.download.extracting,
          icon: <FileDirectoryIcon />,
          onClick: () => {
            extractGameDownload(game.shop, game.objectId);
          },
        },
        {
          label: t("stop_seeding"),
          disabled: deleting,
          icon: <UnlinkIcon />,
          show:
            game.download?.status === "seeding" &&
            game.download?.downloader === Downloader.Torrent,
          onClick: () => {
            pauseSeeding(game.shop, game.objectId);
          },
        },
        {
          label: t("resume_seeding"),
          disabled: deleting,
          icon: <LinkIcon />,
          show:
            game.download?.status !== "seeding" &&
            game.download?.downloader === Downloader.Torrent,
          onClick: () => {
            resumeSeeding(game.shop, game.objectId);
          },
        },
        {
          label: t("delete"),
          disabled: deleting,
          icon: <TrashIcon />,
          onClick: () => {
            openDeleteGameModal(game.shop, game.objectId);
          },
        },
      ];
    }

    if (isGameDownloading) {
      return [
        {
          label: t("pause"),
          onClick: () => {
            pauseDownload(game.shop, game.objectId);
          },
          icon: <ColumnsIcon />,
        },
        {
          label: t("cancel"),
          onClick: () => {
            cancelDownload(game.shop, game.objectId);
          },
          icon: <XCircleIcon />,
        },
      ];
    }

    const isResumeDisabled =
      (download?.downloader === Downloader.RealDebrid &&
        !userPreferences?.realDebridApiToken) ||
      (download?.downloader === Downloader.TorBox &&
        !userPreferences?.torBoxApiToken);

    return [
      {
        label: t("resume"),
        disabled: isResumeDisabled,
        onClick: () => {
          resumeDownload(game.shop, game.objectId);
        },
        icon: <PlayIcon />,
      },
      {
        label: t("cancel"),
        onClick: () => {
          cancelDownload(game.shop, game.objectId);
        },
        icon: <XCircleIcon />,
      },
    ];
  };

  if (!library.length) return null;

  return (
    <div className="download-group">
      <div className="download-group__header">
        <h2>{title}</h2>
        <div className="download-group__header-divider" />
        <h3 className="download-group__header-count">{library.length}</h3>
      </div>

      <ul className="download-group__downloads">
        {library.map((game) => {
          return (
            <li
              key={game.id}
              className={cn("download-group__item", {
                "download-group__item--hydra-debrid":
                  game.download?.downloader === Downloader.Hydra,
              })}
            >
              <div className="download-group__cover">
                <div className="download-group__cover-backdrop">
                  <img
                    src={steamUrlBuilder.library(game.objectId)}
                    className="download-group__cover-image"
                    alt={game.title}
                  />

                  <div className="download-group__cover-content">
                    <Badge>{DOWNLOADER_NAME[game.download!.downloader]}</Badge>
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
                            objectId: game.objectId,
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
                      className="download-group__menu-button"
                      theme="outline"
                    >
                      <ThreeBarsIcon />
                    </Button>
                  </DropdownMenu>
                )}
              </div>

              {game.download?.downloader === Downloader.Hydra && (
                <div
                  style={{
                    background:
                      "linear-gradient(90deg, #01483C 0%, #0CF1CA 50%, #01483C 100%)",
                    boxShadow: "0px 0px 8px 0px rgba(12, 241, 202, 0.15)",
                    width: "100%",
                    position: "absolute",
                    bottom: 0,
                    height: 2,
                    zIndex: 1,
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
