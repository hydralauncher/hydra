import type { GameShop, LibraryGame, SeedingStatus } from "@types";

import { Button, ConfirmationModal } from "@renderer/components";
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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

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
  LinkIcon,
  PlayIcon,
  TrashIcon,
  UnlinkIcon,
  XCircleIcon,
} from "@primer/octicons-react";
import { MoreVertical, Folder } from "lucide-react";
import { average } from "color.js";

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
      (download?.downloader === Downloader.Premiumize &&
        !userPreferences?.premiumizeApiToken) ||
      (download?.downloader === Downloader.AllDebrid &&
        !userPreferences?.allDebridApiToken) ||
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
          {downloadInfo.map(({ game, size, progress }) => {
            const isGameExtracting = extraction?.visibleId === game.id;
            const isGameDownloading =
              isGameDownloadingMap[game.id] && !isGameExtracting;
            const downloadSpeed = isGameDownloading
              ? (lastPacket?.downloadSpeed ?? 0)
              : 0;

            let currentProgress = progress;
            if (isGameExtracting && extraction) {
              currentProgress = extraction.progress;
            } else if (isGameDownloading && lastPacket) {
              currentProgress = lastPacket.progress;
            }

            const isDownloadingItem =
              isDownloadingGroup && (isGameDownloading || isGameExtracting);

            return (
              <li
                key={game.id}
                className="download-group__simple-card"
                style={{ padding: "16px 24px", alignItems: "center" }}
              >
                <button
                  type="button"
                  onClick={() => navigate(buildGameDetailsPath(game))}
                  className="download-group__simple-thumbnail"
                  style={{ width: "80px", height: "80px", borderRadius: "8px" }}
                >
                  <img
                    src={game.logoImageUrl || game.libraryImageUrl || ""}
                    alt={game.title}
                    style={{ objectFit: "cover" }}
                  />
                </button>

                <div
                  className="download-group__simple-info"
                  style={{ flex: 1 }}
                >
                  <button
                    type="button"
                    onClick={() => navigate(buildGameDetailsPath(game))}
                    className="download-group__simple-title-button"
                  >
                    <h3
                      className="download-group__simple-title"
                      style={{ fontSize: "18px" }}
                    >
                      {game.title}
                    </h3>
                  </button>
                  <div
                    className="download-group__simple-meta"
                    style={{
                      flexDirection: "row",
                      gap: "16px",
                      opacity: 0.7,
                      marginTop: "4px",
                    }}
                  >
                    <div className="download-group__simple-meta-row">
                      <span className="download-group__simple-meta-icon">
                        <DownloadIcon size={12} />
                      </span>
                      <span>
                        {DOWNLOADER_NAME[Number(game.download!.downloader)]}
                      </span>
                    </div>
                    {isDownloadingItem ? null : (
                      <div className="download-group__simple-meta-row">
                        <span className="download-group__simple-meta-icon">
                          <FileDirectoryIcon size={12} />
                        </span>
                        <span className="download-group__simple-meta-path">
                          {game.download?.downloadPath ?? "—"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {(isQueuedGroup || isDownloadingItem) && (
                  <div
                    className="download-group__simple-progress-container"
                    style={{
                      flex: 1.5,
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      minWidth: "180px",
                      maxWidth: "350px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        width: "100%",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "13px",
                          fontWeight: 500,
                          color: "rgba(255, 255, 255, 0.7)",
                        }}
                      >
                        {isDownloadingItem &&
                        !isGameExtracting &&
                        lastPacket ? (
                          <>
                            {formatBytes(lastPacket.download.bytesDownloaded)} /{" "}
                            {size} •{" "}
                            {calculateETA() || tGameDetails("calculating_eta")}{" "}
                            • {formatSpeed(downloadSpeed)}
                          </>
                        ) : isGameExtracting && extraction ? (
                          <>
                            {t("extracting")} (
                            {Math.round(extraction.progress * 100)}%)
                          </>
                        ) : isQueuedGroup ? (
                          <>{size}</>
                        ) : null}
                      </span>
                      <span
                        className="download-group__simple-progress-text"
                        style={{ fontSize: "14px", fontWeight: "600" }}
                      >
                        {formatDownloadProgress(currentProgress)}
                      </span>
                    </div>
                    <div
                      className="download-group__progress-bar"
                      style={{
                        marginTop: 0,
                        height: "6px",
                        backgroundColor: "rgba(255,255,255,0.1)",
                      }}
                    >
                      <div
                        className="download-group__progress-fill"
                        style={{
                          width: `${currentProgress * 100}%`,
                          backgroundColor: "#fff",
                        }}
                      />
                    </div>
                  </div>
                )}

                <div
                  className="download-group__simple-actions"
                  style={{ marginLeft: "16px" }}
                >
                  {isDownloadingItem && !isGameExtracting && (
                    <Button
                      theme="primary"
                      onClick={() => pauseDownload(game.shop, game.objectId)}
                      className="download-group__simple-menu-btn"
                      tooltip={t("pause")}
                    >
                      <ColumnsIcon size={16} />
                    </Button>
                  )}
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
