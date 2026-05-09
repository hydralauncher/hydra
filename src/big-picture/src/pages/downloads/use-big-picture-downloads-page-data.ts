import { Downloader, formatBytes, formatBytesToMbps } from "@shared";
import type { LibraryGame, UserPreferences } from "../../../../types";
import { getBigPictureDownloadView } from "../../../../types";
import { addMilliseconds, format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DOWNLOADER_NAME, IS_DESKTOP } from "../../constants";
import {
  getBigPictureGameDetailsPath,
  resolveImageSource,
} from "../../helpers";
import { useDate, useDownloadLayout, useLibrary } from "../../hooks";
import {
  initializeBigPictureDownloadsStore,
  useBigPictureDownloadsStore,
} from "../../stores";

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
  return download.status === "error" ? "Error" : "Paused";
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
  const { library, updateLibrary } = useLibrary();
  const { layoutState } = useDownloadLayout();
  const { formatDistance } = useDate();
  const [userPreferences, setUserPreferences] =
    useState<UserPreferences | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const lastPacket = useBigPictureDownloadsStore((state) => state.lastPacket);
  const seedingStatuses = useBigPictureDownloadsStore(
    (state) => state.seedingStatuses
  );
  const extractionProgressByGameId = useBigPictureDownloadsStore(
    (state) => state.extractionProgressByGameId
  );
  const speedHistoryByGameId = useBigPictureDownloadsStore(
    (state) => state.speedHistoryByGameId
  );
  const peakSpeedByGameId = useBigPictureDownloadsStore(
    (state) => state.peakSpeedByGameId
  );
  const setLastPacket = useBigPictureDownloadsStore(
    (state) => state.setLastPacket
  );

  useEffect(() => {
    if (!IS_DESKTOP) return;

    initializeBigPictureDownloadsStore();
  }, []);

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

  const downloadsById = useMemo(() => {
    return new Map(
      library
        .filter((game) => game.download && game.download.status !== "removed")
        .map((game) => [game.id, game])
    );
  }, [library]);

  const downloadView = useMemo(() => {
    const downloads = library
      .map((game) => game.download)
      .filter((download): download is NonNullable<typeof download> => {
        return Boolean(download && download.status !== "removed");
      });

    return getBigPictureDownloadView(downloads, layoutState);
  }, [layoutState, library]);

  const activeGame = useMemo(() => {
    if (!downloadView.heroId) return null;
    return downloadsById.get(downloadView.heroId) ?? null;
  }, [downloadView.heroId, downloadsById]);

  const queuedGames = useMemo(() => {
    return downloadView.queueIds
      .map((id) => downloadsById.get(id) ?? null)
      .filter((game): game is LibraryGame => game !== null);
  }, [downloadView.queueIds, downloadsById]);

  const pausedGames = useMemo(() => {
    return downloadView.pausedIds
      .map((id) => downloadsById.get(id) ?? null)
      .filter((game): game is LibraryGame => game !== null);
  }, [downloadView.pausedIds, downloadsById]);

  const completedGames = useMemo(() => {
    return downloadView.completedIds
      .map((id) => downloadsById.get(id) ?? null)
      .filter((game): game is LibraryGame => game !== null);
  }, [downloadView.completedIds, downloadsById]);

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
      ? (lastPacket?.download.fileSize ?? download.fileSize)
      : download.fileSize;
    const eta =
      !isExtracting && shouldUseLivePacket
        ? getEtaLabel(lastPacket?.timeRemaining, formatDistance)
        : null;

    let statusLabel = "Active";
    let statusTone: DownloadTone = "active";
    let speedLabel = "0 B/s";
    let pauseOrResumeAction: "pause" | "resume" = "pause";
    const canPauseOrResume = !isExtracting;

    if (download.status === "error") {
      statusLabel = "Error";
      statusTone = "error";
      speedLabel = "Retry available";
      pauseOrResumeAction = "resume";
    } else if (isPausedHero) {
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

    if (!isPausedHero && download.status !== "error") {
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
    return pausedGames.map((game, index) => {
      const download = game.download;
      const isError = download?.status === "error";

      return {
        id: game.id,
        title: game.title,
        href: getBigPictureGameDetailsPath(game),
        coverImageUrl: getDownloadCoverImageUrl(game),
        metaLabel: getDownloadMetaLabel(game),
        statusLabel: isError ? getErrorStatusLabel(download) : "Paused",
        statusTone: isError ? "error" : "paused",
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
        canMoveUp: index > 0,
        canMoveDown: index < pausedGames.length - 1,
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

      if (
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
    const speedHistory = activeGame
      ? (speedHistoryByGameId[activeGame.id] ?? [])
      : [];
    const peakSpeed = activeGame ? (peakSpeedByGameId[activeGame.id] ?? 0) : 0;
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
    peakSpeedByGameId,
    speedHistoryByGameId,
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
      game.objectId,
      "queueIfActive"
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

  const removeDownload = useCallback(
    async (game: LibraryGame) => {
      if (!IS_DESKTOP || !game.download) return;

      if (game.download.status === "seeding") {
        await globalThis.window.electron.pauseGameSeed(
          game.shop,
          game.objectId
        );
      }

      await globalThis.window.electron.deleteGameFolder(
        game.shop,
        game.objectId
      );
      await updateLibrary();
    },
    [updateLibrary]
  );

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
