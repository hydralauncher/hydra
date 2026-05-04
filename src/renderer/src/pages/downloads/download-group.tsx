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
  useToast,
} from "@renderer/hooks";

import "./download-group.scss";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  DropdownMenu,
  DropdownMenuItem,
} from "@renderer/components/dropdown-menu/dropdown-menu";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ColumnsIcon,
  DownloadIcon,
  FileDirectoryIcon,
  FileIcon,
  LinkIcon,
  PeopleIcon,
  PlayIcon,
  TrashIcon,
  UnlinkIcon,
  XCircleIcon,
} from "@primer/octicons-react";
import { MoreVertical, Folder, Upload, ArrowUpFromLine } from "lucide-react";
import { average } from "color.js";

import { HeroDownloadView } from "./hero-download-view";
import { SelectExecutableActionModal } from "./select-executable-action-modal";
import { listContainerVariants, listItemVariants } from "./download-animations";

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

const CHART_BACKGROUND_COLOR = "#121212";
const COLOR_DISTANCE_THRESHOLD = 28;
const FALLBACK_CHART_COLOR = "#f0f1f7";

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

export interface DownloadGroupProps {
  library: LibraryGame[];
  title: string;
  openDeleteGameModal: (shop: GameShop, objectId: string) => void;
  openGameInstaller: (shop: GameShop, objectId: string) => void;
  onBinaryNotFound: () => void;
  seedingStatus: SeedingStatus[];
  queuedGameIds?: string[];
}

export function DownloadGroup({
  library,
  title,
  openDeleteGameModal,
  openGameInstaller,
  onBinaryNotFound,
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
  const { showSuccessToast } = useToast();

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
    Record<string, "install" | "open-folder" | "select-executable">
  >({});
  const [selectExeModalVisible, setSelectExeModalVisible] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [selectExeGame, setSelectExeGame] = useState<LibraryGame | null>(null);

  const extractDominantColor = useCallback(
    async (imageUrl: string, gameId: string) => {
      if (dominantColors[gameId]) return;

      try {
        const color = await average(imageUrl, { amount: 1, format: "hex" });
        const colorString =
          typeof color === "string" ? color : color.toString();
        setDominantColors((prev) => ({ ...prev, [gameId]: colorString }));
      } catch (_error) {
        // Dominant color extraction is best-effort
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
    if (entry) return entry.status === "seeding" || entry.status === 5;
    return game.download?.status === "seeding";
  };

  const getGameUploadSpeed = (game: LibraryGame): number => {
    const entry = seedingStatus.find((s) => s.gameId === game.id);
    return entry?.uploadSpeed ?? 0;
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

    if (
      isGameDownloading &&
      lastPacket?.download.fileSize &&
      lastPacket.download.fileSize > 0
    )
      return formatBytes(lastPacket.download.fileSize);

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

  const handleClearFromList = useCallback(
    async (shop: GameShop, objectId: string) => {
      await window.electron.removeGame(shop, objectId);
      updateLibrary();
    },
    [updateLibrary]
  );

  const handleSelectExecutable = useCallback(
    async (game: LibraryGame) => {
      const download = game.download;
      if (!download?.folderName || !download?.downloadPath) return;

      const folderPath = download.downloadPath + "/" + download.folderName;

      const result = await window.electron.showOpenDialog({
        defaultPath: folderPath,
        properties: ["openFile"],
        filters: [
          {
            name: t("executable_files"),
            extensions: ["exe", "msi", "lnk"],
          },
        ],
      });

      if (result.canceled || !result.filePaths.length) return;

      const filePath = result.filePaths[0];
      setSelectedFilePath(filePath);
      setSelectExeGame(game);
      setSelectExeModalVisible(true);
    },
    [t]
  );

  const handleSetAsGameExecutable = useCallback(async () => {
    if (!selectExeGame || !selectedFilePath) return;

    await window.electron.updateExecutablePath(
      selectExeGame.shop,
      selectExeGame.objectId,
      selectedFilePath
    );

    updateLibrary();
    setSelectExeModalVisible(false);
    setSelectExeGame(null);
    setSelectedFilePath("");
  }, [selectExeGame, selectedFilePath, updateLibrary]);

  const handleRunAsInstaller = useCallback(async () => {
    if (!selectedFilePath) return;

    const success =
      await window.electron.runGameInstallerFile(selectedFilePath);

    if (!success) {
      onBinaryNotFound();
    } else {
      showSuccessToast(t("installer_launched"));
    }

    setSelectExeModalVisible(false);
    setSelectExeGame(null);
    setSelectedFilePath("");
  }, [selectedFilePath, onBinaryNotFound, showSuccessToast, t]);

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
        uploadSpeed: getGameUploadSpeed(game),
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
      const newActionTypes: Record<
        string,
        "install" | "open-folder" | "select-executable"
      > = {};
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
  const isSeedingGroup = title === t("seeding_active");
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
    const dataKey = lastPacket?.gameId ?? game.id;
    const gameSpeedHistory = speedHistory[dataKey] ?? [];
    const storedPeak = peakSpeeds[dataKey];
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

  if (isSeedingGroup && library.length > 0) {
    const totalUploadSpeed = downloadInfo.reduce(
      (acc, item) => acc + item.uploadSpeed,
      0
    );

    return (
      <div className="download-group download-group--seeding">
        <div className="download-group__header">
          <div className="download-group__header-title-group">
            <div className="download-group__seeding-header-icon">
              <ArrowUpFromLine size={16} />
            </div>
            <h2>{title}</h2>
            <h3 className="download-group__header-count">{library.length}</h3>
          </div>
          {totalUploadSpeed > 0 && (
            <motion.div
              className="download-group__seeding-total-speed"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.3 }}
            >
              <Upload size={14} />
              <span>{formatSpeed(totalUploadSpeed)}</span>
            </motion.div>
          )}
        </div>

        <motion.ul
          className="download-group__simple-list"
          variants={listContainerVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence mode="popLayout">
            {downloadInfo.map(({ game, size, uploadSpeed }) => {
              const seedStatus = seedingStatus.find(
                (s) => s.gameId === game.id
              );
              const numSeeds = seedStatus?.numSeeds ?? 0;
              const numPeers = seedStatus?.numPeers ?? 0;

              return (
                <motion.li
                  key={game.id}
                  className="download-group__seeding-card"
                  variants={listItemVariants}
                  layout
                  exit="exit"
                >
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
                        <span className="download-group__seeding-indicator">
                          <span className="download-group__seeding-dot" />
                          <span className="download-group__simple-seeding">
                            {t("seeding")}
                          </span>
                        </span>
                        <span className="download-group__simple-size">
                          <DownloadIcon size={14} />
                          {size}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="download-group__seeding-stats">
                    <div className="download-group__seeding-stat">
                      <Upload
                        size={14}
                        className="download-group__seeding-stat-icon download-group__seeding-stat-icon--upload"
                      />
                      <div className="download-group__seeding-stat-data">
                        <span className="download-group__seeding-stat-value download-group__seeding-stat-value--upload">
                          {uploadSpeed > 0
                            ? `${formatBytes(uploadSpeed)}/s`
                            : "0 B/s"}
                        </span>
                        <span className="download-group__seeding-stat-label">
                          {t("upload_speed")}
                        </span>
                      </div>
                    </div>
                    <div className="download-group__seeding-stat">
                      <PeopleIcon
                        size={14}
                        className="download-group__seeding-stat-icon download-group__seeding-stat-icon--seeds"
                      />
                      <div className="download-group__seeding-stat-data">
                        <span className="download-group__seeding-stat-value download-group__seeding-stat-value--seeds">
                          {numSeeds}
                        </span>
                        <span className="download-group__seeding-stat-label">
                          {t("seeds")}
                        </span>
                      </div>
                    </div>
                    <div className="download-group__seeding-stat">
                      <PeopleIcon
                        size={14}
                        className="download-group__seeding-stat-icon"
                      />
                      <div className="download-group__seeding-stat-data">
                        <span className="download-group__seeding-stat-value">
                          {numPeers}
                        </span>
                        <span className="download-group__seeding-stat-label">
                          {t("peers")}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="download-group__simple-actions">
                    <DropdownMenu align="end" items={getGameActions(game)}>
                      <Button
                        theme="outline"
                        className="download-group__simple-menu-btn"
                      >
                        <MoreVertical size={16} />
                      </Button>
                    </DropdownMenu>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </motion.ul>
      </div>
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

        <motion.ul
          className="download-group__simple-list"
          variants={listContainerVariants}
          initial="hidden"
          animate="visible"
        >
          <AnimatePresence mode="popLayout">
            {downloadInfo.map(
              ({ game, size, progress, isSeeding: seeding, uploadSpeed }) => {
                return (
                  <motion.li
                    key={game.id}
                    className="download-group__simple-card"
                    variants={listItemVariants}
                    layout
                    exit="exit"
                  >
                    {isQueuedGroup &&
                      (() => {
                        const queueIndex = queuedGameIds.indexOf(game.id);
                        return queueIndex !== -1 ? (
                          <span className="download-group__queue-position">
                            {t("queue_position", { position: queueIndex + 1 })}
                          </span>
                        ) : null;
                      })()}

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
                            <span className="download-group__seeding-indicator">
                              <span className="download-group__seeding-dot" />
                              <span className="download-group__simple-seeding">
                                {t("seeding")}
                              </span>
                            </span>
                          )}
                          {game.download?.progress === 1 &&
                            seeding &&
                            uploadSpeed > 0 && (
                              <span className="download-group__simple-upload-speed">
                                <Upload size={12} />
                                {formatBytes(uploadSpeed)}/s
                              </span>
                            )}
                        </div>
                        {extraction?.visibleId === game.id && (
                          <div className="download-group__card-extraction-bar">
                            <div className="download-group__progress-bar download-group__progress-bar--small">
                              <div
                                className="download-group__progress-fill download-group__progress-fill--extraction"
                                style={{
                                  width: `${extraction.progress * 100}%`,
                                }}
                              />
                            </div>
                          </div>
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
                            }}
                          />
                        </div>
                      </div>
                    )}

                    {isCompletedGroup && game.download?.timestamp && (
                      <span className="download-group__download-date">
                        {formatDistance(game.download.timestamp, new Date(), {
                          addSuffix: true,
                        })}
                      </span>
                    )}

                    <div className="download-group__simple-actions">
                      {game.download?.progress === 1 &&
                        (() => {
                          if (game.executablePath) {
                            return (
                              <>
                                <Button
                                  theme="primary"
                                  onClick={() =>
                                    window.electron.openGame(
                                      game.shop,
                                      game.objectId,
                                      game.executablePath!,
                                      game.launchOptions
                                    )
                                  }
                                  disabled={isGameDeleting(game.id)}
                                  className="download-group__simple-action-btn"
                                >
                                  <PlayIcon size={16} />
                                  {t("play")}
                                </Button>
                                <Button
                                  theme="outline"
                                  onClick={() =>
                                    handleClearFromList(
                                      game.shop,
                                      game.objectId
                                    )
                                  }
                                  disabled={isGameDeleting(game.id)}
                                  className="download-group__simple-menu-btn"
                                  tooltip={t("clear_from_list")}
                                >
                                  <XCircleIcon size={16} />
                                </Button>
                              </>
                            );
                          }

                          const actionType =
                            gameActionTypes[game.id] || "open-folder";

                          if (actionType === "select-executable") {
                            return (
                              <Button
                                theme="primary"
                                onClick={() => handleSelectExecutable(game)}
                                disabled={isGameDeleting(game.id)}
                                className="download-group__simple-action-btn"
                              >
                                <FileIcon size={16} />
                                {t("select_executable")}
                              </Button>
                            );
                          }

                          return (
                            <Button
                              theme="primary"
                              onClick={() =>
                                openGameInstaller(game.shop, game.objectId)
                              }
                              disabled={isGameDeleting(game.id)}
                              className="download-group__simple-action-btn"
                            >
                              {actionType === "install" ? (
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
                          onClick={() =>
                            resumeDownload(game.shop, game.objectId)
                          }
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
                  </motion.li>
                );
              }
            )}
          </AnimatePresence>
        </motion.ul>
      </div>

      <SelectExecutableActionModal
        visible={selectExeModalVisible}
        fileName={selectedFilePath.split(/[/\\]/).pop() || ""}
        onClose={() => {
          setSelectExeModalVisible(false);
          setSelectExeGame(null);
          setSelectedFilePath("");
        }}
        onSetAsGameExecutable={handleSetAsGameExecutable}
        onRunAsInstaller={handleRunAsInstaller}
      />
    </>
  );
}
