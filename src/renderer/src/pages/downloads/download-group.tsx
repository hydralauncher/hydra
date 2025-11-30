import type { GameShop, LibraryGame, SeedingStatus } from "@types";

import { Badge, Button } from "@renderer/components";
import { formatDownloadProgress } from "@renderer/helpers";

import { Downloader, formatBytes, formatBytesToMbps } from "@shared";
import { formatDistance, addMilliseconds } from "date-fns";
import { DOWNLOADER_NAME } from "@renderer/constants";
import { useAppSelector, useDownload, useLibrary } from "@renderer/hooks";

import "./download-group.scss";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  GraphIcon,
} from "@primer/octicons-react";
import { average } from "color.js";

interface SpeedChartProps {
  speeds: number[];
  peakSpeed: number;
  color?: string;
}

function SpeedChart({
  speeds,
  peakSpeed,
  color = "rgba(255, 255, 255, 1)",
}: Readonly<SpeedChartProps>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;

    const draw = () => {
      const clientWidth = canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = clientWidth * dpr;
      canvas.height = 100 * dpr;
      ctx.scale(dpr, dpr);

      const width = clientWidth;
      const height = 100;
      const totalBars = 120;
      const barWidth = 4;
      const barGap = 10;
      const barSpacing = barWidth + barGap;
      const maxHeight = peakSpeed || Math.max(...speeds, 1);

      ctx.clearRect(0, 0, width, height);

      let r = 255,
        g = 255,
        b = 255;
      if (color.startsWith("#")) {
        const hex = color.replace("#", "");
        r = Number.parseInt(hex.substring(0, 2), 16);
        g = Number.parseInt(hex.substring(2, 4), 16);
        b = Number.parseInt(hex.substring(4, 6), 16);
      } else if (color.startsWith("rgb")) {
        const matches = color.match(/\d+/g);
        if (matches && matches.length >= 3) {
          r = Number.parseInt(matches[0]);
          g = Number.parseInt(matches[1]);
          b = Number.parseInt(matches[2]);
        }
      }
      const displaySpeeds = speeds.slice(-totalBars);

      for (let i = 0; i < totalBars; i++) {
        const x = i * barSpacing;
        ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
        ctx.beginPath();
        ctx.roundRect(x, 0, barWidth, height, 3);
        ctx.fill();

        if (i < displaySpeeds.length) {
          const speed = displaySpeeds[i] || 0;
          const filledHeight = (speed / maxHeight) * height;

          if (filledHeight > 0) {
            const gradient = ctx.createLinearGradient(
              0,
              height - filledHeight,
              0,
              height
            );

            gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
            gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0.7)`);

            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.roundRect(x, height - filledHeight, barWidth, filledHeight, 3);
            ctx.fill();
          }
        }
      }
      animationFrameId = requestAnimationFrame(draw);
    };

    animationFrameId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [speeds, peakSpeed, color]);

  return (
    <canvas ref={canvasRef} className="download-group__speed-chart-canvas" />
  );
}

interface HeroDownloadViewProps {
  game: LibraryGame;
  isGameDownloading: boolean;
  downloadSpeed: number;
  finalDownloadSize: string;
  peakSpeed: number;
  currentProgress: number;
  dominantColor: string;
  lastPacket: ReturnType<typeof useDownload>["lastPacket"];
  speedHistory: number[];
  getStatusText: (game: LibraryGame) => string;
  formatSpeed: (speed: number) => string;
  calculateETA: () => string;
  pauseDownload: (shop: GameShop, objectId: string) => void;
  resumeDownload: (shop: GameShop, objectId: string) => void;
  cancelDownload: (shop: GameShop, objectId: string) => void;
  t: (key: string) => string;
}

function HeroDownloadView({
  game,
  isGameDownloading,
  downloadSpeed,
  finalDownloadSize,
  peakSpeed,
  currentProgress,
  dominantColor,
  lastPacket,
  speedHistory,
  getStatusText,
  formatSpeed,
  calculateETA,
  pauseDownload,
  resumeDownload,
  cancelDownload,
  t,
}: Readonly<HeroDownloadViewProps>) {
  return (
    <div className="download-group download-group--hero">
      <div className="download-group__hero-background">
        <img
          src={game.libraryHeroImageUrl || game.libraryImageUrl || ""}
          alt={game.title}
        />
        <div className="download-group__hero-overlay" />
      </div>

      <div className="download-group__hero-content">
        <div className="download-group__hero-action-row">
          <div className="download-group__hero-logo">
            {game.logoImageUrl ? (
              <img src={game.logoImageUrl} alt={game.title} />
            ) : (
              <h1>{game.title}</h1>
            )}
          </div>
        </div>

        <div className="download-group__hero-progress">
          <div className="download-group__progress-row download-group__progress-row--bar">
            <div className="download-group__progress-wrapper">
              <div className="download-group__progress-info-row">
                <span className="download-group__progress-status">
                  {getStatusText(game)}
                </span>
                <span className="download-group__progress-percentage">
                  {formatDownloadProgress(currentProgress)}
                </span>
              </div>
              <div className="download-group__progress-info-row">
                <span className="download-group__progress-size">
                  {isGameDownloading && lastPacket
                    ? `${formatBytes(lastPacket.download.bytesDownloaded)} / ${finalDownloadSize}`
                    : `0 B / ${finalDownloadSize}`}
                </span>
                <span className="download-group__progress-time">
                  {isGameDownloading &&
                  lastPacket?.timeRemaining &&
                  lastPacket.timeRemaining > 0
                    ? calculateETA()
                    : ""}
                </span>
              </div>
              <div className="download-group__progress-bar">
                <div
                  className="download-group__progress-fill"
                  style={{
                    width: `${currentProgress * 100}%`,
                  }}
                />
              </div>
            </div>
            <div className="download-group__hero-buttons">
              {isGameDownloading ? (
                <button
                  type="button"
                  onClick={() => pauseDownload(game.shop, game.objectId)}
                  className="download-group__glass-btn"
                >
                  <ColumnsIcon size={14} />
                  {t("pause")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => resumeDownload(game.shop, game.objectId)}
                  className="download-group__glass-btn"
                >
                  <PlayIcon size={14} />
                  {t("resume")}
                </button>
              )}
              <button
                type="button"
                onClick={() => cancelDownload(game.shop, game.objectId)}
                className="download-group__glass-btn"
              >
                <XCircleIcon size={14} />
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>

        <div className="download-group__hero-stats">
          <div className="download-group__stats-column">
            <div className="download-group__stat-item">
              <span style={{ color: dominantColor, display: "flex" }}>
                <DownloadIcon size={16} />
              </span>
              <div className="download-group__stat-content">
                <span className="download-group__stat-label">
                  {t("network")}:
                </span>
                <span className="download-group__stat-value">
                  {isGameDownloading ? formatSpeed(downloadSpeed) : "0 B/s"}
                </span>
              </div>
            </div>

            <div className="download-group__stat-item">
              <span style={{ color: dominantColor, display: "flex" }}>
                <GraphIcon size={16} />
              </span>
              <div className="download-group__stat-content">
                <span className="download-group__stat-label">{t("peak")}:</span>
                <span className="download-group__stat-value">
                  {peakSpeed > 0 ? formatSpeed(peakSpeed) : "0 B/s"}
                </span>
              </div>
            </div>

            {game.download?.downloader === Downloader.Torrent &&
              isGameDownloading &&
              lastPacket &&
              (lastPacket.numSeeds > 0 || lastPacket.numPeers > 0) && (
                <div className="download-group__stat-item">
                  <div className="download-group__stat-content">
                    <span className="download-group__stat-label">
                      Seeds:{" "}
                      <span className="download-group__stat-value">
                        {lastPacket.numSeeds}
                      </span>
                      , Peers:{" "}
                      <span className="download-group__stat-value">
                        {lastPacket.numPeers}
                      </span>
                    </span>
                  </div>
                </div>
              )}
          </div>

          <div className="download-group__speed-chart">
            <SpeedChart
              speeds={speedHistory}
              peakSpeed={peakSpeed}
              color={dominantColor}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const speedHistoryRef = useRef<Record<string, number[]>>({});
  const [dominantColors, setDominantColors] = useState<Record<string, string>>(
    {}
  );

  const extractDominantColor = useCallback(
    async (imageUrl: string, gameId: string) => {
      if (dominantColors[gameId]) return;

      try {
        const color = await average(imageUrl, { amount: 1, format: "hex" });
        const colorString =
          typeof color === "string" ? color : color.toString();
        setDominantColors((prev) => ({ ...prev, [gameId]: colorString }));
      } catch (error) {
        console.error("Failed to extract dominant color:", error);
      }
    },
    [dominantColors]
  );

  useEffect(() => {
    if (lastPacket?.gameId && lastPacket.downloadSpeed !== undefined) {
      const gameId = lastPacket.gameId;

      const currentPeak = peakSpeedsRef.current[gameId] || 0;
      if (lastPacket.downloadSpeed > currentPeak) {
        peakSpeedsRef.current[gameId] = lastPacket.downloadSpeed;
      }

      if (!speedHistoryRef.current[gameId]) {
        speedHistoryRef.current[gameId] = [];
      }

      speedHistoryRef.current[gameId].push(lastPacket.downloadSpeed);

      if (speedHistoryRef.current[gameId].length > 120) {
        speedHistoryRef.current[gameId].shift();
      }
    }
  }, [lastPacket?.gameId, lastPacket?.downloadSpeed]);

  useEffect(() => {
    for (const game of library) {
      if (
        game.download &&
        game.download.progress < 0.01 &&
        game.download.status !== "paused"
      ) {
        // Fresh download - clear any old data
        if (speedHistoryRef.current[game.id]?.length > 0) {
          speedHistoryRef.current[game.id] = [];
          peakSpeedsRef.current[game.id] = 0;
        }
      }
    }
  }, [library]);

  useEffect(() => {
    const timeouts: NodeJS.Timeout[] = [];

    for (const game of library) {
      if (
        game.download?.progress === 1 &&
        speedHistoryRef.current[game.id]?.length > 0
      ) {
        const timeout = setTimeout(() => {
          speedHistoryRef.current[game.id] = [];
          peakSpeedsRef.current[game.id] = 0;
        }, 10_000);
        timeouts.push(timeout);
      }
    }

    return () => {
      for (const timeout of timeouts) {
        clearTimeout(timeout);
      }
    };
  }, [library]);

  useEffect(() => {
    if (library.length > 0 && title === t("download_in_progress")) {
      const game = library[0];
      const heroImageUrl =
        game.libraryHeroImageUrl || game.libraryImageUrl || "";
      if (heroImageUrl && game.id) {
        extractDominantColor(heroImageUrl, game.id);
      }
    }
  }, [library, title, t, extractDominantColor]);

  const isGameSeeding = (game: LibraryGame) => {
    const entry = seedingStatus.find((s) => s.gameId === game.id);
    if (entry?.status) return entry.status === "seeding";
    return game.download?.status === "seeding";
  };

  const isGameDownloadingMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const game of library) {
      map[game.id] = lastPacket?.gameId === game.id;
    }
    return map;
  }, [library, lastPacket?.gameId]);

  const getFinalDownloadSize = (game: LibraryGame) => {
    const download = game.download!;
    const isGameDownloading = isGameDownloadingMap[game.id];

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
    if (
      !lastPacket ||
      lastPacket.timeRemaining < 0 ||
      !Number.isFinite(lastPacket.timeRemaining)
    ) {
      return "";
    }

    return formatDistance(
      addMilliseconds(new Date(), lastPacket.timeRemaining),
      new Date(),
      { addSuffix: true }
    );
  };

  const getCompletedStatusText = (game: LibraryGame) => {
    const isTorrent = game.download?.downloader === Downloader.Torrent;
    if (isTorrent) {
      return isGameSeeding(game)
        ? `${t("completed")} (${t("seeding")})`
        : `${t("completed")} (${t("paused")})`;
    }
    return t("completed");
  };

  const getStatusText = (game: LibraryGame) => {
    const isGameDownloading = isGameDownloadingMap[game.id];
    const status = game.download?.status;

    if (game.download?.extracting) {
      return t("extracting");
    }

    if (isGameDeleting(game.id)) {
      return t("deleting");
    }

    if (game.download?.progress === 1) {
      return getCompletedStatusText(game);
    }

    if (isGameDownloading && lastPacket) {
      if (lastPacket.isDownloadingMetadata) {
        return t("downloading_metadata");
      }
      if (lastPacket.isCheckingFiles) {
        return t("checking_files");
      }
      return t("download_in_progress");
    }

    switch (status) {
      case "paused":
      case "error":
        return t("paused");
      case "waiting":
        return t("calculating_eta");
      default:
        return t("paused");
    }
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
    const isGameDownloading = isGameDownloadingMap[game.id];

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

  const downloadInfo = useMemo(
    () =>
      library.map((game) => ({
        game,
        size: getFinalDownloadSize(game),
        progress: game.download?.progress || 0,
        isSeeding: isGameSeeding(game),
      })),
    [library, lastPacket?.gameId]
  );

  if (!library.length) return null;

  const isDownloadingGroup = title === t("download_in_progress");
  const isQueuedGroup = title === t("queued_downloads");
  const isCompletedGroup = title === t("downloads_completed");

  if (isDownloadingGroup && library.length > 0) {
    const game = library[0];
    const isGameDownloading = isGameDownloadingMap[game.id];
    const downloadSpeed = isGameDownloading
      ? (lastPacket?.downloadSpeed ?? 0)
      : 0;
    const finalDownloadSize = getFinalDownloadSize(game);
    const peakSpeed = peakSpeedsRef.current[game.id] || 0;
    const currentProgress =
      isGameDownloading && lastPacket
        ? lastPacket.progress
        : game.download?.progress || 0;

    const dominantColor = dominantColors[game.id] || "#fff";

    return (
      <HeroDownloadView
        game={game}
        isGameDownloading={isGameDownloading}
        downloadSpeed={downloadSpeed}
        finalDownloadSize={finalDownloadSize}
        peakSpeed={peakSpeed}
        currentProgress={currentProgress}
        dominantColor={dominantColor}
        lastPacket={lastPacket}
        speedHistory={speedHistoryRef.current[game.id] || []}
        getStatusText={getStatusText}
        formatSpeed={formatSpeed}
        calculateETA={calculateETA}
        pauseDownload={pauseDownload}
        resumeDownload={resumeDownload}
        cancelDownload={cancelDownload}
        t={t}
      />
    );
  }

  return (
    <div
      className={`download-group ${isQueuedGroup ? "download-group--queued" : ""} ${isCompletedGroup ? "download-group--completed" : ""}`}
    >
      <div className="download-group__header">
        <h2>{title}</h2>
        <div className="download-group__header-divider" />
        <h3 className="download-group__header-count">{library.length}</h3>
      </div>

      <ul className="download-group__simple-list">
        {downloadInfo.map(({ game, size, progress, isSeeding: seeding }) => {
          return (
            <li key={game.id} className="download-group__simple-card">
              <div className="download-group__simple-thumbnail">
                <img src={game.libraryImageUrl || ""} alt={game.title} />
              </div>

              <div className="download-group__simple-info">
                <h3 className="download-group__simple-title">{game.title}</h3>
                <div className="download-group__simple-meta">
                  <Badge>{DOWNLOADER_NAME[game.download!.downloader]}</Badge>
                  <span className="download-group__simple-size">{size}</span>
                  {game.download?.progress === 1 && seeding && (
                    <span className="download-group__simple-seeding">
                      {t("seeding")}
                    </span>
                  )}
                </div>
              </div>

              {isQueuedGroup && (
                <div className="download-group__simple-progress">
                  <span className="download-group__simple-progress-text">
                    {formatDownloadProgress(progress)}
                  </span>
                  <div className="download-group__progress-bar download-group__progress-bar--small">
                    <div
                      className="download-group__progress-fill"
                      style={{
                        width: `${progress * 100}%`,
                        backgroundColor: "#fff",
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="download-group__simple-actions">
                {game.download?.progress === 1 && (
                  <Button
                    theme="primary"
                    onClick={() => openGameInstaller(game.shop, game.objectId)}
                    disabled={isGameDeleting(game.id)}
                    className="download-group__simple-menu-btn"
                  >
                    <DownloadIcon size={16} />
                  </Button>
                )}
                {isQueuedGroup && game.download?.progress !== 1 && (
                  <Button
                    theme="primary"
                    onClick={() => resumeDownload(game.shop, game.objectId)}
                    className="download-group__simple-menu-btn"
                  >
                    <PlayIcon size={16} />
                  </Button>
                )}
                <DropdownMenu align="end" items={getGameActions(game)}>
                  <Button
                    theme="outline"
                    className="download-group__simple-menu-btn"
                  >
                    <ThreeBarsIcon />
                  </Button>
                </DropdownMenu>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
