import { useNavigate } from "react-router-dom";

import type { GameShop, LibraryGame, SeedingStatus } from "@types";

import { Badge, Button } from "@renderer/components";
import {
  buildGameDetailsPath,
  formatDownloadProgress,
} from "@renderer/helpers";

import { Downloader, formatBytes, steamUrlBuilder } from "@shared";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { useAppSelector, useDownload } from "@renderer/hooks";

import "./download-group.scss";
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

import torBoxLogo from "@renderer/assets/icons/torbox.webp";

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

  const getGameInfo = (game: LibraryGame) => {
    const download = game.download!;

    const isGameDownloading = lastPacket?.gameId === game.id;
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
            {formatBytes(lastPacket.download.bytesDownloaded)} /{" "}
            {finalDownloadSize}
          </p>

          {download.downloader === Downloader.Torrent && (
            <small>
              {lastPacket?.numPeers} peers / {lastPacket?.numSeeds} seeds
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
          <p>{t("seeding")}</p>
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

    if (download?.progress === 1) {
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
          label: t("stop_seeding"),
          disabled: deleting,
          icon: <UnlinkIcon />,
          show:
            download.status === "seeding" &&
            download.downloader === Downloader.Torrent,
          onClick: () => {
            pauseSeeding(game.shop, game.objectId);
          },
        },
        {
          label: t("resume_seeding"),
          disabled: deleting,
          icon: <LinkIcon />,
          show:
            download.status !== "seeding" &&
            download.downloader === Downloader.Torrent,
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

    if (isGameDownloading || download?.status === "active") {
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

    return [
      {
        label: t("resume"),
        disabled:
          download?.downloader === Downloader.RealDebrid &&
          !userPreferences?.realDebridApiToken,
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
            <li key={game.id} className="download-group__item">
              <div className="download-group__cover">
                <div className="download-group__cover-backdrop">
                  <img
                    src={steamUrlBuilder.library(game.objectId)}
                    className="download-group__cover-image"
                    alt={game.title}
                  />

                  <div className="download-group__cover-content">
                    {game.download?.downloader === Downloader.TorBox ? (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          background: "#11141b",
                          padding: `${SPACING_UNIT / 2}px ${SPACING_UNIT}px`,
                          borderRadius: "4px",
                          gap: 4,
                          border: `1px solid ${vars.color.border}`,
                        }}
                      >
                        <img
                          src={torBoxLogo}
                          alt="TorBox"
                          style={{ width: 13 }}
                        />
                        <span style={{ fontSize: 10 }}>TorBox</span>
                      </div>
                    ) : (
                      <Badge>
                        {DOWNLOADER_NAME[game.download!.downloader]}
                      </Badge>
                    )}
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
            </li>
          );
        })}
      </ul>
    </div>
  );
}
