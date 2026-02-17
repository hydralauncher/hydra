import type { GameShop, LibraryGame, SeedingStatus } from "@types";

import { Badge, Button, ConfirmationModal } from "@renderer/components";
import {
  formatDownloadProgress,
  buildGameDetailsPath,
} from "@renderer/helpers";

import { Downloader, formatBytes, formatBytesToMbps } from "@shared";
import { addMilliseconds } from "date-fns";
import { DOWNLOADER_NAME } from "@renderer/constants";
import {
  useAppSelector,
  useDownload,
  useLibrary,
  useDate,
} from "@renderer/hooks";

import "./download-group.scss";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@renderer/components/dropdown-menu/dropdown-menu";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ClockIcon,
  ColumnsIcon,
  DownloadIcon,
  FileDirectoryIcon,
  LinkIcon,
  PlayIcon,
  TrashIcon,
  UnlinkIcon,
  XCircleIcon,
  GraphIcon,
} from "@primer/octicons-react";
import { MoreVertical, Folder } from "lucide-react";
import { average } from "color.js";

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const r = Number.parseInt(h.substring(0, 2), 16) || 0;
  const g = Number.parseInt(h.substring(2, 4), 16) || 0;
  const b = Number.parseInt(h.substring(4, 6), 16) || 0;
  return [r, g, b];
}

function isTooCloseRGB(a: string, b: string, threshold: number): boolean {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const distance = Math.sqrt(
    Math.pow(r1 - r2, 2) + Math.pow(g1 - g2, 2) + Math.pow(b1 - b2, 2)
  );
  return distance < threshold;
}

const CHART_BACKGROUND_COLOR = "#1a1a1a";
const COLOR_DISTANCE_THRESHOLD = 28;
const FALLBACK_CHART_COLOR = "#fff";

function pickChartColor(dominant?: string): string {
  if (!dominant || typeof dominant !== "string" || !dominant.startsWith("#")) {
    return FALLBACK_CHART_COLOR;
  }

  if (
    isTooCloseRGB(dominant, CHART_BACKGROUND_COLOR, COLOR_DISTANCE_THRESHOLD)
  ) {
    return FALLBACK_CHART_COLOR;
  }

  return dominant;
}

interface AnimatedPercentageProps {
  value: number;
}

function AnimatedPercentage({ value }: Readonly<AnimatedPercentageProps>) {
  const percentageText = formatDownloadProgress(value);
  const prevTextRef = useRef<string>(percentageText);
  const chars = percentageText.split("");
  const prevChars = prevTextRef.current.split("");

  useEffect(() => {
    prevTextRef.current = percentageText;
  }, [percentageText]);

  return (
    <>
      {chars.map((char, index) => {
        const prevChar = prevChars[index];
        const charChanged = prevChar !== char;

        return (
          <AnimatePresence key={`${index}`} mode="wait" initial={false}>
            <motion.span
              key={`${char}-${value}-${index}`}
              initial={
                charChanged ? { y: 10, opacity: 0 } : { y: 0, opacity: 1 }
              }
              animate={{ y: 0, opacity: 1 }}
              exit={charChanged ? { y: -10, opacity: 0 } : undefined}
              transition={{ duration: 0.3, ease: "easeOut" }}
              style={{ display: "inline-block" }}
            >
              {char}
            </motion.span>
          </AnimatePresence>
        );
      })}
    </>
  );
}

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
    let resizeObserver: ResizeObserver | null = null;

    const draw = () => {
      const clientWidth = canvas.clientWidth;
      const dpr = window.devicePixelRatio || 1;

      canvas.width = clientWidth * dpr;
      canvas.height = 100 * dpr;
      ctx.scale(dpr, dpr);

      const width = clientWidth;
      const height = 100;
      const barWidth = 4;
      const barGap = 10;
      const barSpacing = barWidth + barGap;

      // Calculate how many bars can fit in the available width
      const totalBars = Math.max(1, Math.floor((width + barGap) / barSpacing));
      const maxHeight = peakSpeed || Math.max(...speeds, 1);

      ctx.clearRect(0, 0, width, height);

      let r = 255,
        g = 255,
        b = 255;
      if (color.startsWith("#")) {
        let hex = color.replace("#", "");
        // Handle shorthand hex colors (e.g., "#fff" -> "#ffffff")
        if (hex.length === 3) {
          hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        r = Number.parseInt(hex.substring(0, 2), 16) || 255;
        g = Number.parseInt(hex.substring(2, 4), 16) || 255;
        b = Number.parseInt(hex.substring(4, 6), 16) || 255;
      } else if (color.startsWith("rgb")) {
        const matches = color.match(/\d+/g);
        if (matches && matches.length >= 3) {
          r = Number.parseInt(matches[0]) || 255;
          g = Number.parseInt(matches[1]) || 255;
          b = Number.parseInt(matches[2]) || 255;
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

    // Handle resize - trigger redraw when canvas size changes
    resizeObserver = new ResizeObserver(() => {
      // Cancel any pending animation frame to force immediate redraw
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      // Trigger a redraw that will recalculate bars based on new width
      draw();
    });
    resizeObserver.observe(canvas);

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [speeds, peakSpeed, color]);

  return (
    <canvas ref={canvasRef} className="download-group__speed-chart-canvas" />
  );
}

interface HeroDownloadViewProps {
  game: LibraryGame;
  isGameDownloading: boolean;
  isGameExtracting?: boolean;
  downloadSpeed: number;
  finalDownloadSize: string;
  peakSpeed: number;
  currentProgress: number;
  dominantColor: string;
  lastPacket: ReturnType<typeof useDownload>["lastPacket"];
  speedHistory: number[];
  formatSpeed: (speed: number) => string;
  calculateETA: () => string | null;
  pauseDownload: (shop: GameShop, objectId: string) => void;
  resumeDownload: (shop: GameShop, objectId: string) => void;
  onCancelClick: (shop: GameShop, objectId: string) => void;
  t: (key: string) => string;
}

function HeroDownloadView({
  game,
  isGameDownloading,
  isGameExtracting = false,
  downloadSpeed,
  finalDownloadSize,
  peakSpeed,
  currentProgress,
  dominantColor,
  lastPacket,
  speedHistory,
  formatSpeed,
  calculateETA,
  pauseDownload,
  resumeDownload,
  onCancelClick,
  t,
}: Readonly<HeroDownloadViewProps>) {
  const navigate = useNavigate();
  const { t: tGameDetails } = useTranslation("game_details");

  const handleLogoClick = useCallback(() => {
    navigate(buildGameDetailsPath(game));
  }, [navigate, game]);

  const etaText = calculateETA();
  const hasEta =
    isGameDownloading &&
    !isGameExtracting &&
    !lastPacket?.isCheckingFiles &&
    !!etaText &&
    etaText.trim() !== "" &&
    etaText !== "0";
  const shouldShowEtaPlaceholder =
    isGameDownloading &&
    !isGameExtracting &&
    !lastPacket?.isCheckingFiles &&
    !hasEta;
  const shouldShowEta = hasEta || shouldShowEtaPlaceholder;

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
              <button
                type="button"
                onClick={handleLogoClick}
                className="download-group__hero-logo-button"
              >
                <img src={game.logoImageUrl} alt={game.title} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLogoClick}
                className="download-group__hero-logo-button"
              >
                <h1>{game.title}</h1>
              </button>
            )}
          </div>
        </div>

        <div className="download-group__hero-progress">
          <div className="download-group__progress-row download-group__progress-row--bar">
            <div className="download-group__progress-wrapper">
              <div className="download-group__progress-info-row">
                {isGameExtracting && (
                  <span className="download-group__progress-status">
                    {t("extracting")}
                  </span>
                )}
                {!isGameExtracting && lastPacket?.isCheckingFiles && (
                  <span className="download-group__progress-status">
                    {t("checking_files")}
                  </span>
                )}
                {!isGameExtracting && !lastPacket?.isCheckingFiles && (
                  <span className="download-group__progress-size">
                    <DownloadIcon size={14} />
                    {isGameDownloading && lastPacket
                      ? `${formatBytes(lastPacket.download.bytesDownloaded)} / ${finalDownloadSize}`
                      : `0 B / ${finalDownloadSize}`}
                  </span>
                )}
                <span></span>
              </div>
              <div className="download-group__progress-info-row">
                {!lastPacket?.isCheckingFiles && !isGameExtracting && (
                  <span className="download-group__progress-time">
                    {shouldShowEta && (
                      <>
                        <ClockIcon size={14} />
                        {hasEta ? etaText : tGameDetails("calculating_eta")}
                      </>
                    )}
                  </span>
                )}
                <span className="download-group__progress-percentage">
                  <AnimatedPercentage value={currentProgress} />
                </span>
              </div>
              <div className="download-group__progress-bar">
                <div
                  className={`download-group__progress-fill ${isGameExtracting ? "download-group__progress-fill--extraction" : ""}`}
                  style={{
                    width: `${currentProgress * 100}%`,
                  }}
                />
              </div>
            </div>
            {!isGameExtracting && (
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
                  onClick={() => onCancelClick(game.shop, game.objectId)}
                  className="download-group__glass-btn"
                >
                  <XCircleIcon size={14} />
                  {t("cancel")}
                </button>
              </div>
            )}
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

            {game.download?.downloader !== undefined && (
              <div className="download-group__stat-item">
                <div className="download-group__stat-content">
                  <Badge>
                    {DOWNLOADER_NAME[Number(game.download.downloader)]}
                  </Badge>
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
  queuedGameIds?: string[];
}

export function DownloadGroup({
  library,
  title,
  openDeleteGameModal,
  openGameInstaller,
  seedingStatus,
  queuedGameIds = [],
}: Readonly<DownloadGroupProps>) {
  const { t } = useTranslation("downloads");
  const { t: tGameDetails } = useTranslation("game_details");
  const navigate = useNavigate();

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const extraction = useAppSelector((state) => state.download.extraction);

  const { updateLibrary } = useLibrary();

  const {
    lastPacket,
    pauseDownload: pauseDownloadOriginal,
    resumeDownload: resumeDownloadOriginal,
    cancelDownload,
    isGameDeleting,
    pauseSeeding,
    resumeSeeding,
  } = useDownload();

  // Wrap resumeDownload with optimistic update
  const resumeDownload = useCallback(
    async (shop: GameShop, objectId: string) => {
      const gameId = `${shop}:${objectId}`;

      // Optimistically mark as downloading
      setOptimisticallyResumed((prev) => ({ ...prev, [gameId]: true }));

      try {
        await resumeDownloadOriginal(shop, objectId);
      } catch (error) {
        // If resume fails, remove optimistic state
        setOptimisticallyResumed((prev) => {
          const next = { ...prev };
          delete next[gameId];
          return next;
        });
        throw error;
      }
    },
    [resumeDownloadOriginal]
  );

  // Wrap pauseDownload to clear optimistic state
  const pauseDownload = useCallback(
    async (shop: GameShop, objectId: string) => {
      const gameId = `${shop}:${objectId}`;

      // Clear optimistic state when pausing
      setOptimisticallyResumed((prev) => {
        const next = { ...prev };
        delete next[gameId];
        return next;
      });

      await pauseDownloadOriginal(shop, objectId);
    },
    [pauseDownloadOriginal]
  );

  const { formatDistance } = useDate();

  // Get speed history and peak speeds from Redux (centralized state)
  const speedHistory = useAppSelector((state) => state.download.speedHistory);
  const peakSpeeds = useAppSelector((state) => state.download.peakSpeeds);
  const [dominantColors, setDominantColors] = useState<Record<string, string>>(
    {}
  );
  const [optimisticallyResumed, setOptimisticallyResumed] = useState<
    Record<string, boolean>
  >({});
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [gameToCancelShop, setGameToCancelShop] = useState<GameShop | null>(
    null
  );
  const [gameToCancelObjectId, setGameToCancelObjectId] = useState<
    string | null
  >(null);
  const [gameActionTypes, setGameActionTypes] = useState<
    Record<string, "install" | "open-folder">
  >({});

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

  // Clear optimistic state when actual download starts or library updates
  useEffect(() => {
    if (lastPacket?.gameId) {
      const gameId = lastPacket.gameId;

      // Clear optimistic state when actual download starts
      setOptimisticallyResumed((prev) => {
        const next = { ...prev };
        delete next[gameId];
        return next;
      });
    }
  }, [lastPacket?.gameId]);

  // Clear optimistic state for games that are no longer active after library update
  useEffect(() => {
    setOptimisticallyResumed((prev) => {
      const next = { ...prev };
      let changed = false;

      for (const gameId in next) {
        if (next[gameId]) {
          const game = library.find((g) => g.id === gameId);
          // Clear if game doesn't exist or download status is not active
          if (
            !game ||
            game.download?.status !== "active" ||
            lastPacket?.gameId === gameId
          ) {
            delete next[gameId];
            changed = true;
          }
        }
      }

      return changed ? next : prev;
    });
  }, [library, lastPacket?.gameId]);

  // Speed history and peak speeds are now tracked in Redux (in setLastPacket reducer)
  // No local effect needed - data is updated atomically when packets arrive

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
      map[game.id] =
        lastPacket?.gameId === game.id ||
        optimisticallyResumed[game.id] === true;
    }
    return map;
  }, [library, lastPacket?.gameId, optimisticallyResumed]);

  const getFinalDownloadSize = (game: LibraryGame) => {
    const download = game.download!;
    const isGameDownloading = isGameDownloadingMap[game.id];

    // Check lastPacket first for most up-to-date size during active downloads
    if (
      isGameDownloading &&
      lastPacket?.download.fileSize &&
      lastPacket.download.fileSize > 0
    )
      return formatBytes(lastPacket.download.fileSize);

    // Then check the stored download size (must be > 0 to be valid)
    if (download.fileSize != null && download.fileSize > 0)
      return formatBytes(download.fileSize);

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
      lastPacket.timeRemaining <= 0 ||
      !Number.isFinite(lastPacket.timeRemaining)
    ) {
      return null;
    }

    return formatDistance(
      addMilliseconds(new Date(), lastPacket.timeRemaining),
      new Date(),
      { addSuffix: true }
    );
  };

  const extractGameDownload = useCallback(
    async (shop: GameShop, objectId: string) => {
      await window.electron.extractGameDownload(shop, objectId);
      updateLibrary();
    },
    [updateLibrary]
  );

  const handleCancelClick = useCallback((shop: GameShop, objectId: string) => {
    setGameToCancelShop(shop);
    setGameToCancelObjectId(objectId);
    setCancelModalVisible(true);
  }, []);

  const handleConfirmCancel = useCallback(async () => {
    if (gameToCancelShop && gameToCancelObjectId) {
      await cancelDownload(gameToCancelShop, gameToCancelObjectId);
    }
    setCancelModalVisible(false);
    setGameToCancelShop(null);
    setGameToCancelObjectId(null);
  }, [gameToCancelShop, gameToCancelObjectId, cancelDownload]);

  const handleCancelModalClose = useCallback(() => {
    setCancelModalVisible(false);
    setGameToCancelShop(null);
    setGameToCancelObjectId(null);
  }, []);

  const handleMoveInQueue = useCallback(
    async (shop: GameShop, objectId: string, direction: "up" | "down") => {
      await window.electron.updateDownloadQueuePosition(
        shop,
        objectId,
        direction
      );
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
            handleCancelClick(game.shop, game.objectId);
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

    const queueIndex = queuedGameIds.indexOf(game.id);
    const isFirstInQueue = queueIndex === 0;
    const isLastInQueue = queueIndex === queuedGameIds.length - 1;
    const isInQueue = queueIndex !== -1;

    const actions = [
      {
        label: t("resume"),
        disabled: isResumeDisabled,
        onClick: () => {
          resumeDownload(game.shop, game.objectId);
        },
        icon: <PlayIcon />,
      },
      {
        label: t("move_up"),
        show: isInQueue && !isFirstInQueue,
        onClick: () => {
          handleMoveInQueue(game.shop, game.objectId, "up");
        },
        icon: <ArrowUpIcon />,
      },
      {
        label: t("move_down"),
        show: isInQueue && !isLastInQueue,
        onClick: () => {
          handleMoveInQueue(game.shop, game.objectId, "down");
        },
        icon: <ArrowDownIcon />,
      },
      {
        label: t("cancel"),
        onClick: () => {
          handleCancelClick(game.shop, game.objectId);
        },
        icon: <XCircleIcon />,
      },
    ];

    return actions.filter((action) => action.show !== false);
  };

  const downloadInfo = useMemo(
    () =>
      library.map((game) => ({
        game,
        size: getFinalDownloadSize(game),
        progress: game.download?.progress || 0,
        isSeeding: isGameSeeding(game),
      })),
    [
      library,
      lastPacket?.gameId,
      lastPacket?.download.fileSize,
      isGameDownloadingMap,
      seedingStatus,
    ]
  );

  // Fetch action types for completed games
  useEffect(() => {
    const fetchActionTypes = async () => {
      const completedGames = library.filter(
        (game) => game.download?.progress === 1
      );

      const actionTypesPromises = completedGames.map(async (game) => {
        try {
          const actionType = await window.electron.getGameInstallerActionType(
            game.shop,
            game.objectId
          );
          return { gameId: game.id, actionType };
        } catch {
          return { gameId: game.id, actionType: "open-folder" as const };
        }
      });

      const results = await Promise.all(actionTypesPromises);
      const newActionTypes: Record<string, "install" | "open-folder"> = {};
      results.forEach(({ gameId, actionType }) => {
        newActionTypes[gameId] = actionType;
      });

      setGameActionTypes((prev) => ({ ...prev, ...newActionTypes }));
    };

    fetchActionTypes();
  }, [library]);

  if (!library.length) return null;

  const isDownloadingGroup = title === t("download_in_progress");
  const isQueuedGroup = title === t("queued_downloads");
  const isCompletedGroup = title === t("downloads_completed");

  if (isDownloadingGroup && library.length > 0) {
    const game = library[0];
    const isGameExtracting = extraction?.visibleId === game.id;
    const isGameDownloading =
      isGameDownloadingMap[game.id] && !isGameExtracting;
    const downloadSpeed = isGameDownloading
      ? (lastPacket?.downloadSpeed ?? 0)
      : 0;
    const finalDownloadSize = getFinalDownloadSize(game);
    // Use lastPacket.gameId for lookup since that's the key used to store the data
    // Fall back to game.id if lastPacket is not available
    const dataKey = lastPacket?.gameId ?? game.id;
    const gameSpeedHistory = speedHistory[dataKey] ?? [];
    const storedPeak = peakSpeeds[dataKey];
    // Use stored peak if available and > 0, otherwise use current speed as initial value
    const peakSpeed =
      storedPeak !== undefined && storedPeak > 0 ? storedPeak : downloadSpeed;

    let currentProgress = game.download?.progress || 0;
    if (isGameExtracting) {
      currentProgress = extraction.progress;
    } else if (isGameDownloading && lastPacket) {
      currentProgress = lastPacket.progress;
    }

    const dominantColor = pickChartColor(dominantColors[game.id]);

    return (
      <>
        <ConfirmationModal
          visible={cancelModalVisible}
          title={t("cancel_download")}
          descriptionText={t("cancel_download_description")}
          confirmButtonLabel={t("yes_cancel")}
          cancelButtonLabel={t("keep_downloading")}
          onConfirm={handleConfirmCancel}
          onClose={handleCancelModalClose}
        />
        <HeroDownloadView
          game={game}
          isGameDownloading={isGameDownloading}
          isGameExtracting={isGameExtracting}
          downloadSpeed={downloadSpeed}
          finalDownloadSize={finalDownloadSize}
          peakSpeed={peakSpeed}
          currentProgress={currentProgress}
          dominantColor={dominantColor}
          lastPacket={lastPacket}
          speedHistory={gameSpeedHistory}
          formatSpeed={formatSpeed}
          calculateETA={calculateETA}
          pauseDownload={pauseDownload}
          resumeDownload={resumeDownload}
          onCancelClick={handleCancelClick}
          t={t}
        />
      </>
    );
  }

  return (
    <>
      <ConfirmationModal
        visible={cancelModalVisible}
        title={t("cancel_download")}
        descriptionText={t("cancel_download_description")}
        confirmButtonLabel={t("yes_cancel")}
        cancelButtonLabel={t("keep_downloading")}
        onConfirm={handleConfirmCancel}
        onClose={handleCancelModalClose}
      />
      <div
        className={`download-group ${isQueuedGroup ? "download-group--queued" : ""} ${isCompletedGroup ? "download-group--completed" : ""}`}
      >
        <div className="download-group__header">
          <div className="download-group__header-title-group">
            <h2>{title}</h2>
            <h3 className="download-group__header-count">{library.length}</h3>
          </div>
        </div>

        <ul className="download-group__simple-list">
          {downloadInfo.map(({ game, size, progress, isSeeding: seeding }) => {
            return (
              <li key={game.id} className="download-group__simple-card">
                <button
                  type="button"
                  onClick={() => navigate(buildGameDetailsPath(game))}
                  className="download-group__simple-thumbnail"
                >
                  <img src={game.libraryImageUrl || ""} alt={game.title} />
                </button>

                <div className="download-group__simple-info">
                  <button
                    type="button"
                    onClick={() => navigate(buildGameDetailsPath(game))}
                    className="download-group__simple-title-button"
                  >
                    <h3 className="download-group__simple-title">
                      {game.title}
                    </h3>
                  </button>
                  <div className="download-group__simple-meta">
                    <div className="download-group__simple-meta-row">
                      <Badge>
                        {DOWNLOADER_NAME[Number(game.download!.downloader)]}
                      </Badge>
                    </div>
                    <div className="download-group__simple-meta-row">
                      {extraction?.visibleId === game.id ? (
                        <span className="download-group__simple-extracting">
                          {t("extracting")} (
                          {Math.round(extraction.progress * 100)}%)
                        </span>
                      ) : (
                        <span className="download-group__simple-size">
                          <DownloadIcon size={14} />
                          {size}
                        </span>
                      )}
                      {game.download?.progress === 1 && seeding && (
                        <span className="download-group__simple-seeding">
                          {t("seeding")}
                        </span>
                      )}
                    </div>
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
                  {game.download?.progress === 1 &&
                    (() => {
                      const actionType =
                        gameActionTypes[game.id] || "open-folder";
                      const isInstall = actionType === "install";

                      return (
                        <Button
                          theme="primary"
                          onClick={() =>
                            openGameInstaller(game.shop, game.objectId)
                          }
                          disabled={isGameDeleting(game.id)}
                          className="download-group__simple-action-btn"
                        >
                          {isInstall ? (
                            <>
                              <DownloadIcon size={16} />
                              {t("install")}
                            </>
                          ) : (
                            <>
                              <Folder size={16} />
                              {tGameDetails("open_folder")}
                            </>
                          )}
                        </Button>
                      );
                    })()}
                  {isQueuedGroup && game.download?.progress !== 1 && (
                    <Button
                      theme="primary"
                      onClick={() => resumeDownload(game.shop, game.objectId)}
                      className="download-group__simple-menu-btn"
                      tooltip={t("resume")}
                    >
                      <DownloadIcon size={16} />
                    </Button>
                  )}
                  <DropdownMenu align="end" items={getGameActions(game)}>
                    <Button
                      theme="outline"
                      className="download-group__simple-menu-btn"
                    >
                      <MoreVertical size={16} />
                    </Button>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
