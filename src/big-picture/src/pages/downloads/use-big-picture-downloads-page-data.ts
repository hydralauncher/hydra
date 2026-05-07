import { Downloader, formatBytes, formatBytesToMbps } from "@shared";
import type {
  DownloadProgress,
  LibraryGame,
  SeedingStatus,
  UserPreferences,
} from "../../../../types";
import {
  getDownloadPlacement,
  isCompletedLikeDownload,
} from "../../../../types";
import { addMilliseconds, format } from "date-fns";
import { orderBy } from "lodash-es";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DOWNLOADER_NAME, IS_DESKTOP } from "../../constants";
import {
  getBigPictureGameDetailsPath,
  resolveImageSource,
} from "../../helpers";
import { useDate, useLibrary } from "../../hooks";

type DownloadTone = "default" | "active" | "paused" | "success" | "error";

export interface BigPictureDownloadListItem {
  id: string;
  title: string;
  href: string;
  coverImageUrl: string | null;
  metaLabel: string;
  statusLabel: string;
  statusTone: DownloadTone;
  progress: number | null;
  trailingLabel: string;
  secondaryLabel: string;
  rightStatusLabel?: string | null;
  progressLabel?: string | null;
  transferLabel?: string | null;
  speedLabel?: string | null;
  etaLabel?: string | null;
  sizeLabel?: string | null;
  queuePosition?: number;
  seedAction?: "pause" | "resume" | null;
  canRemove: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  game: LibraryGame;
}

export interface BigPictureActiveDownloadItem {
  id: string;
  title: string;
  href: string;
  coverImageUrl: string | null;
  metaLabel: string;
  statusLabel: string;
  statusTone: DownloadTone;
  progress: number;
  progressLabel: string;
  transferLabel: string;
  speedLabel: string;
  etaLabel: string | null;
  sizeLabel: string;
  pauseOrResumeAction: "pause" | "resume";
  canPauseOrResume: boolean;
  canMoveFromHero: boolean;
  canPromoteToHero: boolean;
  game: LibraryGame;
}

export interface BigPictureDownloadsNetworkStats {
  speedLabel: string;
  peakSpeedLabel: string;
  speedHistory: number[];
  speedHistoryLabels: string[];
  seeds: number | null;
  peers: number | null;
  showSeedsAndPeers: boolean;
}

const SPEED_HISTORY_SAMPLE_SIZE = 120;

export function getDownloadCoverImageUrl(
  game: Pick<
    LibraryGame,
    | "customHeroImageUrl"
    | "libraryHeroImageUrl"
    | "coverImageUrl"
    | "libraryImageUrl"
    | "customIconUrl"
    | "iconUrl"
  >
): string | null {
  return (
    [
      game.libraryHeroImageUrl,
      game.customHeroImageUrl,
      game.coverImageUrl,
      game.libraryImageUrl,
      game.customIconUrl,
      game.iconUrl,
    ]
      .map((source) => resolveImageSource(source))
      .find(Boolean) ?? null
  );
}

export function getDownloadLogoImageUrl(
  game: Pick<LibraryGame, "customLogoImageUrl" | "logoImageUrl">
): string | null {
  return (
    [game.customLogoImageUrl, game.logoImageUrl]
      .map((source) => resolveImageSource(source))
      .find(Boolean) ?? null
  );
}

function formatProgress(progress?: number) {
  if (!progress) return "0%";

  const percentage = progress * 100;

  if (Number.isInteger(percentage)) {
    return `${percentage}%`;
  }

  return `${percentage.toFixed(1)}%`;
}

function formatSpeed(
  value: number,
  userPreferences: UserPreferences | null
): string {
  if (value <= 0) return "0 B/s";

  return userPreferences?.showDownloadSpeedInMegabytes
    ? `${formatBytes(value)}/s`
    : formatBytesToMbps(value);
}

function getDownloadSize(download: LibraryGame["download"]) {
  return download?.fileSize != null
    ? formatBytes(download.fileSize)
    : "Unknown";
}

function getDownloadMetaLabel(game: LibraryGame) {
  const download = game.download;

  if (!download) return "Not downloaded";

  return DOWNLOADER_NAME[download.downloader];
}

function getErrorStatusLabel(download: LibraryGame["download"]) {
  if (!download) return "Error";
  return download.status === "error" ? "Error" : "Completed";
}

function formatTransfer(
  bytesDownloaded?: number | null,
  fileSize?: number | null
): string | null {
  if (bytesDownloaded == null && fileSize == null) return null;
  if (bytesDownloaded == null)
    return fileSize != null ? formatBytes(fileSize) : null;
  if (fileSize == null) return formatBytes(bytesDownloaded);

  return `${formatBytes(bytesDownloaded)} / ${formatBytes(fileSize)}`;
}

function getEtaLabel(
  timeRemaining: number | null | undefined,
  formatDistance: ReturnType<typeof useDate>["formatDistance"]
) {
  if (
    timeRemaining == null ||
    timeRemaining <= 0 ||
    !Number.isFinite(timeRemaining)
  ) {
    return null;
  }

  return formatDistance(
    addMilliseconds(new Date(), timeRemaining),
    new Date(),
    { addSuffix: true }
  );
}

function getFinishedAtLabel(timestamp: number | null | undefined) {
  if (timestamp == null || !Number.isFinite(timestamp)) {
    return "Finished";
  }

  try {
    return `Finished at ${format(new Date(timestamp), "h:mm a")}`;
  } catch {
    return "Finished";
  }
}

export function useBigPictureDownloadsPageData() {
  const { library } = useLibrary();
  const { formatDistance } = useDate();
  const [lastPacket, setLastPacket] = useState<DownloadProgress | null>(null);
  const [seedingStatuses, setSeedingStatuses] = useState<SeedingStatus[]>([]);
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null);
  const [extractionProgressByGameId, setExtractionProgressByGameId] = useState<
    Record<string, number>
  >({});
  const [speedHistory, setSpeedHistory] = useState<number[]>([]);
  const [peakSpeed, setPeakSpeed] = useState(0);
  const [renderTick, setRenderTick] = useState(0);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    globalThis.window.electron
      .getUserPreferences()
      .then((preferences) => {
        setUserPreferences(preferences);
      })
      .catch(() => {
        setUserPreferences(null);
      });
  }, []);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    const unsubscribeDownloadProgress =
      globalThis.window.electron.onDownloadProgress((downloadProgress) => {
        if (
          downloadProgress?.progress === 1 &&
          !downloadProgress.isCheckingFiles &&
          !downloadProgress.isDownloadingMetadata
        ) {
          setLastPacket(null);
          return;
        }

        setLastPacket(downloadProgress);
      });

    const unsubscribeSeedingStatus = globalThis.window.electron.onSeedingStatus(
      (value) => {
        setSeedingStatuses(value);
      }
    );

    const unsubscribeExtractionProgress =
      globalThis.window.electron.onExtractionProgress(
        (shop, objectId, progress) => {
          setExtractionProgressByGameId((current) => ({
            ...current,
            [`${shop}:${objectId}`]: progress,
          }));
        }
      );

    const clearExtractionState = (shop: string, objectId: string) => {
      const gameId = `${shop}:${objectId}`;

      setExtractionProgressByGameId((current) => {
        if (!(gameId in current)) return current;

        const next = { ...current };
        delete next[gameId];
        return next;
      });
    };

    const unsubscribeExtractionComplete =
      globalThis.window.electron.onExtractionComplete((shop, objectId) => {
        clearExtractionState(shop, objectId);
      });

    const unsubscribeExtractionFailed =
      globalThis.window.electron.onExtractionFailed((shop, objectId) => {
        clearExtractionState(shop, objectId);
      });

    return () => {
      unsubscribeDownloadProgress();
      unsubscribeSeedingStatus();
      unsubscribeExtractionProgress();
      unsubscribeExtractionComplete();
      unsubscribeExtractionFailed();
    };
  }, []);

  useEffect(() => {
    const hasSeedingActivity = seedingStatuses.some(
      (status) => status.status === "seeding" && status.uploadSpeed > 0
    );
    const shouldTick = Boolean(lastPacket || hasSeedingActivity);

    if (!shouldTick) return;

    const interval = globalThis.window.setInterval(() => {
      setRenderTick((current) => current + 1);
    }, 1000);

    return () => {
      globalThis.window.clearInterval(interval);
    };
  }, [lastPacket, seedingStatuses]);

  const sortedDownloads = useMemo(() => {
    return orderBy(
      library.filter(
        (game) => game.download && game.download.status !== "removed"
      ),
      (game) => game.download?.timestamp ?? 0,
      "desc"
    );
  }, [library]);

  const activeGame = useMemo(() => {
    const heroGame = sortedDownloads.find((game) => {
      const download = game.download;
      if (!download) return false;

      return getDownloadPlacement(download) === "hero";
    });

    return heroGame ?? null;
  }, [sortedDownloads]);

  const queuedGames = useMemo(() => {
    return orderBy(
      sortedDownloads.filter((game) => {
        const download = game.download;
        if (!download) return false;
        if (activeGame?.id === game.id) return false;

        return getDownloadPlacement(download) === "queue";
      }),
      (game) => game.download?.timestamp ?? 0,
      "asc"
    );
  }, [activeGame?.id, sortedDownloads]);

  const pausedGames = useMemo(() => {
    return orderBy(
      sortedDownloads.filter((game) => {
        const download = game.download;
        if (!download) return false;
        if (activeGame?.id === game.id) return false;

        return getDownloadPlacement(download) === "paused";
      }),
      (game) => game.download?.timestamp ?? 0,
      "asc"
    );
  }, [activeGame?.id, sortedDownloads]);

  const completedGames = useMemo(() => {
    return sortedDownloads.filter((game) => {
      const download = game.download;
      if (!download) return false;
      if (activeGame?.id === game.id) return false;

      return isCompletedLikeDownload(download);
    });
  }, [activeGame?.id, sortedDownloads]);

  const activeDownload = useMemo((): BigPictureActiveDownloadItem | null => {
    if (!activeGame?.download) return null;

    const download = activeGame.download;
    const isExtracting = download.extracting;
    const isPausedHero = download.status === "paused";
    const extractionProgress =
      extractionProgressByGameId[activeGame.id] ?? download.extractionProgress;
    const shouldUseLivePacket =
      !isPausedHero && lastPacket?.gameId === activeGame.id;
    const packetProgress = lastPacket?.progress ?? download.progress;
    const progress = isExtracting
      ? extractionProgress
      : shouldUseLivePacket
        ? Math.max(packetProgress, download.progress)
        : download.progress;
    const packetBytesDownloaded =
      lastPacket?.download.bytesDownloaded ?? download.bytesDownloaded;
    const bytesDownloaded = isExtracting
      ? download.fileSize != null
        ? Math.round(download.fileSize * progress)
        : download.bytesDownloaded
      : shouldUseLivePacket
        ? Math.max(packetBytesDownloaded, download.bytesDownloaded)
        : download.bytesDownloaded;
    const sizeInBytes = shouldUseLivePacket
      ? lastPacket?.download.fileSize ?? download.fileSize
      : download.fileSize;
    const eta =
      !isExtracting && shouldUseLivePacket
        ? getEtaLabel(lastPacket?.timeRemaining, formatDistance)
        : null;

    let statusLabel = "Active";
    let statusTone: DownloadTone = "active";
    let speedLabel = "0 B/s";
    let pauseOrResumeAction: "pause" | "resume" = "pause";
    let canPauseOrResume = !isExtracting;

    if (isPausedHero) {
      statusLabel = "Paused";
      statusTone = "paused";
      speedLabel = "Paused";
      pauseOrResumeAction = "resume";
    } else if (isExtracting) {
      statusLabel = "Extracting";
    } else if (lastPacket?.isCheckingFiles) {
      statusLabel = "Checking files";
    } else if (lastPacket?.isDownloadingMetadata) {
      statusLabel = "Downloading metadata";
    } else {
      statusLabel = "In progress";
    }

    if (!isPausedHero) {
      speedLabel = isExtracting
        ? "Preparing files"
        : formatSpeed(lastPacket?.downloadSpeed ?? 0, userPreferences);
    }

    return {
      id: activeGame.id,
      title: activeGame.title,
      href: getBigPictureGameDetailsPath(activeGame),
      coverImageUrl: getDownloadCoverImageUrl(activeGame),
      metaLabel: getDownloadMetaLabel(activeGame),
      statusLabel,
      statusTone,
      progress,
      progressLabel: formatProgress(progress),
      transferLabel:
        formatTransfer(bytesDownloaded, sizeInBytes) ??
        formatBytes(bytesDownloaded),
      speedLabel,
      etaLabel: eta,
      sizeLabel: sizeInBytes != null ? formatBytes(sizeInBytes) : "Unknown",
      pauseOrResumeAction,
      canPauseOrResume,
      canMoveFromHero: !isExtracting,
      canPromoteToHero: !isExtracting,
      game: activeGame,
    };
  }, [
    activeGame,
    extractionProgressByGameId,
    formatDistance,
    lastPacket,
    renderTick,
    userPreferences,
  ]);

  useEffect(() => {
    if (!activeGame) {
      setSpeedHistory([]);
      setPeakSpeed(0);
      return;
    }

    setSpeedHistory([]);
    setPeakSpeed(0);
  }, [activeGame?.id]);

  useEffect(() => {
    if (!activeGame || lastPacket?.gameId !== activeGame.id) return;

    const speed = lastPacket.downloadSpeed ?? 0;

    setSpeedHistory((current) => {
      const next = [...current, speed];
      if (next.length > SPEED_HISTORY_SAMPLE_SIZE) {
        next.splice(0, next.length - SPEED_HISTORY_SAMPLE_SIZE);
      }
      return next;
    });

    setPeakSpeed((current) => Math.max(current, speed));
  }, [activeGame, lastPacket?.downloadSpeed, lastPacket?.gameId]);

  const queuedDownloads = useMemo((): BigPictureDownloadListItem[] => {
    return queuedGames.map((game, index) => {
      const download = game.download;

      return {
        id: game.id,
        title: game.title,
        href: getBigPictureGameDetailsPath(game),
        coverImageUrl: getDownloadCoverImageUrl(game),
        metaLabel: getDownloadMetaLabel(game),
        statusLabel: "Queued",
        statusTone: "default",
        progress: download?.progress ?? 0,
        trailingLabel: getDownloadSize(download),
        secondaryLabel:
          formatTransfer(download?.bytesDownloaded, download?.fileSize) ??
          getDownloadSize(download),
        rightStatusLabel: null,
        progressLabel: formatProgress(download?.progress ?? 0),
        transferLabel: formatTransfer(
          download?.bytesDownloaded,
          download?.fileSize
        ),
        sizeLabel: getDownloadSize(download),
        queuePosition: index,
        seedAction: null,
        canRemove: false,
        canMoveUp: index > 0,
        canMoveDown: index < queuedGames.length - 1,
        game,
      };
    });
  }, [queuedGames]);

  const pausedDownloads = useMemo((): BigPictureDownloadListItem[] => {
    return pausedGames.map((game) => {
      const download = game.download;

      return {
        id: game.id,
        title: game.title,
        href: getBigPictureGameDetailsPath(game),
        coverImageUrl: getDownloadCoverImageUrl(game),
        metaLabel: getDownloadMetaLabel(game),
        statusLabel: "Paused",
        statusTone: "paused",
        progress: download?.progress ?? 0,
        trailingLabel: formatProgress(download?.progress ?? 0),
        secondaryLabel:
          formatTransfer(download?.bytesDownloaded, download?.fileSize) ??
          getDownloadSize(download),
        rightStatusLabel: null,
        progressLabel: formatProgress(download?.progress ?? 0),
        transferLabel: formatTransfer(
          download?.bytesDownloaded,
          download?.fileSize
        ),
        sizeLabel: getDownloadSize(download),
        seedAction: null,
        canRemove: false,
        canMoveUp: false,
        canMoveDown: false,
        game,
      };
    });
  }, [pausedGames]);

  const completedDownloads = useMemo((): BigPictureDownloadListItem[] => {
    return completedGames.map((game) => {
      const seedingStatus = seedingStatuses.find(
        (status) => status.gameId === game.id
      );
      const download = game.download;

      let statusLabel = "Completed";
      let statusTone: DownloadTone = "success";
      let trailingLabel = getDownloadSize(download);
      let rightStatusLabel = getFinishedAtLabel(download?.timestamp);
      let seedAction: BigPictureDownloadListItem["seedAction"] = null;

      if (download?.status === "error") {
        statusLabel = getErrorStatusLabel(download);
        statusTone = "error";
        rightStatusLabel = statusLabel;
      } else if (
        download?.status === "seeding" ||
        seedingStatus?.status === "seeding"
      ) {
        statusLabel = "Seeding";
        statusTone = "active";
        trailingLabel = formatSpeed(
          seedingStatus?.uploadSpeed ?? 0,
          userPreferences
        );
        rightStatusLabel = `Seeding: ${trailingLabel}`;
        seedAction = "pause";
      } else if (
        download?.status === "complete" &&
        download.downloader === Downloader.Torrent
      ) {
        seedAction = "resume";
      }

      return {
        id: game.id,
        title: game.title,
        href: getBigPictureGameDetailsPath(game),
        coverImageUrl: getDownloadCoverImageUrl(game),
        metaLabel: getDownloadMetaLabel(game),
        statusLabel,
        statusTone,
        progress: download?.progress ?? null,
        trailingLabel,
        secondaryLabel:
          formatTransfer(download?.bytesDownloaded, download?.fileSize) ??
          getDownloadSize(download),
        rightStatusLabel,
        progressLabel:
          download?.status === "error"
            ? formatProgress(download.progress)
            : null,
        transferLabel:
          download?.status === "error"
            ? formatTransfer(download.bytesDownloaded, download.fileSize)
            : null,
        speedLabel:
          download?.status === "seeding" || seedingStatus?.status === "seeding"
            ? formatSpeed(seedingStatus?.uploadSpeed ?? 0, userPreferences)
            : null,
        sizeLabel: getDownloadSize(download),
        seedAction,
        canRemove: true,
        canMoveUp: false,
        canMoveDown: false,
        game,
      };
    });
  }, [completedGames, renderTick, seedingStatuses, userPreferences]);

  const hasDownloads = Boolean(
    activeDownload ||
      queuedDownloads.length ||
      pausedDownloads.length ||
      completedDownloads.length
  );

  const networkStats = useMemo((): BigPictureDownloadsNetworkStats => {
    const speedHistorySamples =
      speedHistory.length >= SPEED_HISTORY_SAMPLE_SIZE
        ? speedHistory
        : [
            ...Array.from(
              { length: SPEED_HISTORY_SAMPLE_SIZE - speedHistory.length },
              () => 0
            ),
            ...speedHistory,
          ];
    const speedHistoryLabels = speedHistorySamples.map((value) =>
      formatSpeed(value, userPreferences)
    );

    if (!activeGame?.download || !activeDownload) {
      return {
        speedLabel: "0 B/s",
        peakSpeedLabel: "0 B/s",
        speedHistory: speedHistorySamples,
        speedHistoryLabels,
        seeds: null,
        peers: null,
        showSeedsAndPeers: false,
      };
    }

    if (activeDownload.pauseOrResumeAction === "resume") {
      return {
        speedLabel: "0 B/s",
        peakSpeedLabel: formatSpeed(peakSpeed, userPreferences),
        speedHistory: speedHistorySamples,
        speedHistoryLabels,
        seeds: null,
        peers: null,
        showSeedsAndPeers: false,
      };
    }

    const shouldZeroSpeed =
      activeGame.download.extracting ||
      lastPacket?.isCheckingFiles ||
      lastPacket?.isDownloadingMetadata ||
      lastPacket?.gameId !== activeGame.id;

    const showSeedsAndPeers =
      activeGame.download.downloader === Downloader.Torrent &&
      lastPacket?.gameId === activeGame.id;

    return {
      speedLabel: shouldZeroSpeed
        ? "0 B/s"
        : formatSpeed(lastPacket?.downloadSpeed ?? 0, userPreferences),
      peakSpeedLabel: formatSpeed(peakSpeed, userPreferences),
      speedHistory: speedHistorySamples,
      speedHistoryLabels,
      seeds: showSeedsAndPeers ? (lastPacket?.numSeeds ?? 0) : null,
      peers: showSeedsAndPeers ? (lastPacket?.numPeers ?? 0) : null,
      showSeedsAndPeers,
    };
  }, [
    activeDownload,
    activeGame,
    lastPacket?.downloadSpeed,
    lastPacket?.gameId,
    lastPacket?.isCheckingFiles,
    lastPacket?.isDownloadingMetadata,
    lastPacket?.numPeers,
    lastPacket?.numSeeds,
    peakSpeed,
    speedHistory,
    userPreferences,
  ]);

  const pauseDownload = useCallback(
    async (game: LibraryGame) => {
      if (!IS_DESKTOP) return;

      await globalThis.window.electron.pauseGameDownload(
        game.shop,
        game.objectId
      );

      if (lastPacket?.gameId === game.id) {
        setLastPacket(null);
      }
    },
    [lastPacket?.gameId]
  );

  const startNow = useCallback(async (game: LibraryGame) => {
    if (!IS_DESKTOP) return;

    await globalThis.window.electron.moveDownloadPlacement(
      game.shop,
      game.objectId,
      "hero"
    );
  }, []);

  const resumeDownload = useCallback(async (game: LibraryGame) => {
    if (!IS_DESKTOP) return;

    await globalThis.window.electron.resumeGameDownload(
      game.shop,
      game.objectId
    );
  }, []);

  const sendToQueue = useCallback(
    async (game: LibraryGame, targetIndex?: number) => {
      if (!IS_DESKTOP) return;

      const resolvedTargetIndex = targetIndex ?? queuedGames.length;

      await globalThis.window.electron.moveDownloadPlacement(
        game.shop,
        game.objectId,
        "queue",
        resolvedTargetIndex
      );
    },
    [queuedGames.length]
  );

  const moveToPaused = useCallback(
    async (game: LibraryGame, targetIndex?: number) => {
      if (!IS_DESKTOP) return;

      const resolvedTargetIndex = targetIndex ?? pausedGames.length;

      await globalThis.window.electron.moveDownloadPlacement(
        game.shop,
        game.objectId,
        "paused",
        resolvedTargetIndex
      );
    },
    [pausedGames.length]
  );

  const cancelDownload = useCallback(
    async (game: LibraryGame) => {
      if (!IS_DESKTOP) return;

      await globalThis.window.electron.cancelGameDownload(
        game.shop,
        game.objectId
      );

      if (lastPacket?.gameId === game.id) {
        setLastPacket(null);
      }

      await globalThis.window.electron.deleteGameFolder(
        game.shop,
        game.objectId
      );
    },
    [lastPacket?.gameId]
  );

  const removeDownload = useCallback(async (game: LibraryGame) => {
    if (!IS_DESKTOP || !game.download) return;

    if (game.download.status === "seeding") {
      await globalThis.window.electron.pauseGameSeed(game.shop, game.objectId);
    }

    await globalThis.window.electron.deleteGameFolder(game.shop, game.objectId);
  }, []);

  const moveQueuedDownload = useCallback(
    async (game: LibraryGame, direction: "up" | "down") => {
      if (!IS_DESKTOP) return;

      await globalThis.window.electron.updateDownloadQueuePosition(
        game.shop,
        game.objectId,
        direction
      );
    },
    []
  );

  const setQueuedDownloadPosition = useCallback(
    async (game: LibraryGame, targetIndex: number) => {
      if (!IS_DESKTOP) return;

      await globalThis.window.electron.setDownloadQueuePosition(
        game.shop,
        game.objectId,
        targetIndex
      );
    },
    []
  );

  const setPausedDownloadPosition = useCallback(
    async (game: LibraryGame, targetIndex: number) => {
      if (!IS_DESKTOP) return;

      await globalThis.window.electron.setPausedDownloadPosition(
        game.shop,
        game.objectId,
        targetIndex
      );
    },
    []
  );

  const pauseSeeding = useCallback(async (game: LibraryGame) => {
    if (!IS_DESKTOP) return;

    await globalThis.window.electron.pauseGameSeed(game.shop, game.objectId);
  }, []);

  const resumeSeeding = useCallback(async (game: LibraryGame) => {
    if (!IS_DESKTOP) return;

    await globalThis.window.electron.resumeGameSeed(game.shop, game.objectId);
  }, []);

  return {
    activeDownload,
    networkStats,
    queuedDownloads,
    pausedDownloads,
    completedDownloads,
    hasDownloads,
    pauseDownload,
    resumeDownload,
    startNow,
    sendToQueue,
    moveToPaused,
    cancelDownload,
    removeDownload,
    moveQueuedDownload,
    setQueuedDownloadPosition,
    setPausedDownloadPosition,
    pauseSeeding,
    resumeSeeding,
  };
}
