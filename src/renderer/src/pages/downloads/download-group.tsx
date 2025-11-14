import cn from "classnames";

import type { GameShop, LibraryGame, SeedingStatus } from "@types";

import { Badge, Button } from "@renderer/components";
import { formatDownloadProgress } from "@renderer/helpers";

import { Downloader, formatBytes, formatBytesToMbps } from "@shared";
import { formatDistance, addMilliseconds } from "date-fns";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { useAppSelector, useDownload, useLibrary } from "@renderer/hooks";

import "./download-group.scss";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef } from "react";
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
  ThreeBarsIcon,
  TrashIcon,
  UnlinkIcon,
  XCircleIcon,
  DatabaseIcon,
  GraphIcon,
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
  const { t } = useTranslation("downloads");

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const { updateLibrary } = useLibrary();

  const {
    lastPacket,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    isGameDeleting,
    pauseSeeding,
    resumeSeeding,
  } = useDownload();

  const peakSpeedsRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (lastPacket?.gameId && lastPacket.downloadSpeed) {
      const currentPeak = peakSpeedsRef.current[lastPacket.gameId] || 0;
      if (lastPacket.downloadSpeed > currentPeak) {
        peakSpeedsRef.current[lastPacket.gameId] = lastPacket.downloadSpeed;
      }
    }
  }, [lastPacket?.gameId, lastPacket?.downloadSpeed]);
  const isGameSeeding = (game: LibraryGame) => {
    const entry = seedingStatus.find((s) => s.gameId === game.id);
    if (entry && entry.status) return entry.status === "seeding";
    return game.download?.status === "seeding";
  };

  const getFinalDownloadSize = (game: LibraryGame) => {
    const download = game.download!;
    const isGameDownloading = lastPacket?.gameId === game.id;

    if (download.fileSize != null) return formatBytes(download.fileSize);

    if (lastPacket?.download.fileSize && isGameDownloading)
      return formatBytes(lastPacket.download.fileSize);

    return "N/A";
  };

  const formatSpeed = (speed: number): string => {
    return userPreferences?.showDownloadSpeedInMegabytes
      ? `${formatBytes(speed)}/s`
      : formatBytesToMbps(speed);
  };

  const calculateETA = () => {
    if (!lastPacket || lastPacket.timeRemaining < 0) return "";

    try {
      return formatDistance(
        addMilliseconds(new Date(), lastPacket.timeRemaining),
        new Date(),
        { addSuffix: true }
      );
    } catch (err) {
      return "";
    }
  };

  const getStatusText = (game: LibraryGame) => {
    const isGameDownloading = lastPacket?.gameId === game.id;
    const status = game.download?.status;

    if (game.download?.extracting) {
      return t("extracting");
    }

    if (isGameDeleting(game.id)) {
      return t("deleting");
    }

    if (game.download?.progress === 1) {
      const isTorrent = game.download?.downloader === Downloader.Torrent;
      if (isTorrent) {
        if (isGameSeeding(game)) {
          return `${t("completed")} (${t("seeding")})`;
        }
        return `${t("completed")} (${t("paused")})`;
      }
      return t("completed");
    }

    if (isGameDownloading) {
      if (lastPacket.isDownloadingMetadata) {
        return t("downloading_metadata");
      }
      if (lastPacket.isCheckingFiles) {
        return t("checking_files");
      }
      if (lastPacket.timeRemaining && lastPacket.timeRemaining > 0) {
        return calculateETA();
      }
      return t("calculating_eta");
    }

    if (status === "paused") {
      return t("paused");
    }
    if (status === "waiting") {
      return t("calculating_eta");
    }
    if (status === "error") {
      return t("paused");
    }

    return t("paused");
  };

  const getSeedsPeersText = (game: LibraryGame) => {
    const isGameDownloading = lastPacket?.gameId === game.id;
    const isTorrent = game.download?.downloader === Downloader.Torrent;

    if (!isTorrent) return null;

    if (game.download?.progress === 1 && isGameSeeding(game)) {
      if (
        isGameDownloading &&
        (lastPacket.numSeeds > 0 || lastPacket.numPeers > 0)
      ) {
        return `${lastPacket.numSeeds} seeds, ${lastPacket.numPeers} peers`;
      }
      return null;
    }

    if (
      isGameDownloading &&
      (lastPacket.numSeeds > 0 || lastPacket.numPeers > 0)
    ) {
      return `${lastPacket.numSeeds} seeds, ${lastPacket.numPeers} peers`;
    }

    return null;
  };

  const extractGameDownload = useCallback(
    async (shop: GameShop, objectId: string) => {
      await window.electron.extractGameDownload(shop, objectId);
      updateLibrary();
    },
    [updateLibrary]
  );

  const getGameActions = (game: LibraryGame): DropdownMenuItem[] => {
    const download = lastPacket?.download;
    const isGameDownloading = lastPacket?.gameId === game.id;

    const deleting = isGameDeleting(game.id);

    if (game.download?.progress === 1) {
      const actions = [
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
            isGameSeeding(game) &&
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
            !isGameSeeding(game) &&
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
      return actions.filter((action) => action.show !== false);
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
          const isGameDownloading = lastPacket?.gameId === game.id;
          const downloadSpeed = isGameDownloading
            ? (lastPacket?.downloadSpeed ?? 0)
            : 0;
          const finalDownloadSize = getFinalDownloadSize(game);
          const peakSpeed = peakSpeedsRef.current[game.id] || 0;

          const currentProgress = isGameDownloading
            ? lastPacket.progress
            : game.download?.progress || 0;

          return (
            <li
              key={game.id}
              className={cn("download-group__item", {
                "download-group__item--hydra":
                  game.download?.downloader === Downloader.Hydra,
              })}
            >
              <div className="download-group__background-image">
                <img
                  src={game.libraryHeroImageUrl || game.libraryImageUrl || ""}
                  alt={game.title}
                />
                <div className="download-group__background-overlay" />
              </div>

              <div className="download-group__content">
                <div className="download-group__left-section">
                  <div className="download-group__logo-container">
                    {game.logoImageUrl ? (
                      <img
                        src={game.logoImageUrl}
                        alt={game.title}
                        className="download-group__logo"
                      />
                    ) : (
                      <h3 className="download-group__game-title">
                        {game.title}
                      </h3>
                    )}
                    <div className="download-group__downloader-badge">
                      <Badge>
                        {DOWNLOADER_NAME[game.download!.downloader]}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="download-group__right-section">
                  <div className="download-group__top-row">
                    <div className="download-group__stats">
                      <div className="download-group__stat">
                        <DownloadIcon size={16} />
                        <div className="download-group__stat-info">
                          <span className="download-group__stat-label">
                            NETWORK
                          </span>
                          <span className="download-group__stat-value">
                            {isGameDownloading
                              ? formatSpeed(downloadSpeed)
                              : "0 B/s"}
                          </span>
                        </div>
                      </div>
                      <div className="download-group__stat">
                        <GraphIcon size={16} />
                        <div className="download-group__stat-info">
                          <span className="download-group__stat-label">
                            PEAK
                          </span>
                          <span className="download-group__stat-value">
                            {peakSpeed > 0 ? formatSpeed(peakSpeed) : "0 B/s"}
                          </span>
                        </div>
                      </div>
                      <div className="download-group__stat">
                        <DatabaseIcon size={16} />
                        <div className="download-group__stat-info">
                          <span className="download-group__stat-label">
                            size on DISK
                          </span>
                          <span className="download-group__stat-value">
                            {finalDownloadSize}
                          </span>
                        </div>
                      </div>
                    </div>

                    {getGameActions(game) !== null && (
                      <DropdownMenu align="end" items={getGameActions(game)}>
                        <Button
                          className="download-group__menu-button"
                          theme="outline"
                        >
                          <ThreeBarsIcon />
                        </Button>
                      </DropdownMenu>
                    )}
                  </div>

                  <div className="download-group__bottom-row">
                    <div className="download-group__progress-section">
                      <div className="download-group__progress-info">
                        <span className="download-group__progress-text">
                          {game.download?.extracting || isGameDeleting(game.id)
                            ? getStatusText(game)
                            : formatDownloadProgress(currentProgress)}
                        </span>
                        {isGameDownloading && (
                          <span className="download-group__progress-size">
                            {formatBytes(lastPacket.download.bytesDownloaded)} /{" "}
                            {finalDownloadSize}
                          </span>
                        )}
                      </div>
                      <div className="download-group__progress-bar">
                        <div
                          className="download-group__progress-fill"
                          style={{
                            width: `${currentProgress * 100}%`,
                          }}
                        />
                      </div>

                      <div className="download-group__time-remaining">
                        {getStatusText(game)}
                        {getSeedsPeersText(game) && (
                          <span style={{ opacity: 0.7, marginLeft: "8px" }}>
                            • {getSeedsPeersText(game)}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="download-group__quick-actions">
                      {game.download?.progress === 1 ? (
                        <Button
                          theme="primary"
                          onClick={() =>
                            openGameInstaller(game.shop, game.objectId)
                          }
                          className="download-group__action-btn"
                          disabled={isGameDeleting(game.id)}
                        >
                          <DownloadIcon size={16} />
                          {t("install")}
                        </Button>
                      ) : isGameDownloading ? (
                        <Button
                          theme="primary"
                          onClick={() =>
                            pauseDownload(game.shop, game.objectId)
                          }
                          className="download-group__action-btn"
                        >
                          <ColumnsIcon size={16} />
                          {t("pause")}
                        </Button>
                      ) : (
                        <Button
                          theme="primary"
                          onClick={() =>
                            resumeDownload(game.shop, game.objectId)
                          }
                          className="download-group__action-btn"
                        >
                          <PlayIcon size={16} />
                          {t("resume")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {game.download?.downloader === Downloader.Hydra && (
                <div className="download-group__hydra-gradient" />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
