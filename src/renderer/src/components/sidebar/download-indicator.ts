import type { DownloadProgress, LibraryGame } from "@types";
import {
  getDownloadId,
  isActiveLikeDownload,
  isQueuedDownload,
} from "../../../../types";

export type DownloadIndicatorPhase =
  | "idle"
  | "downloading"
  | "paused"
  | "extracting"
  | "preparing";

export interface DownloadIndicatorState {
  phase: DownloadIndicatorPhase;
  /** Progress of the current game, from 0 to 1. Null while it has no percent yet. */
  progress: number | null;
  /** Games left to finish, the current one included. */
  games: number;
}

export interface DownloadIndicatorInput {
  downloads: LibraryGame[];
  lastPacket: Pick<
    DownloadProgress,
    | "gameId"
    | "progress"
    | "isDownloadingMetadata"
    | "isReconnecting"
    | "isRecovering"
    | "recoveryProgress"
  > | null;
  extraction: { visibleId: string; progress: number } | null;
  /** Download ids in queue order, as the Downloads page shows them. */
  queueOrder: string[];
}

const IDLE: DownloadIndicatorState = {
  phase: "idle",
  progress: null,
  games: 0,
};

/**
 * Sums up the download queue for the sidebar's Downloads icon: what the
 * current game is doing, how far along it is, and how many games are left.
 */
export function getDownloadIndicatorState({
  downloads,
  lastPacket,
  extraction,
  queueOrder,
}: DownloadIndicatorInput): DownloadIndicatorState {
  const tracked = downloads.filter(
    (game) => game.download && game.download.status !== "removed"
  );
  const queued = tracked.filter((game) => isQueuedDownload(game.download!));
  const games = 1 + queued.length;

  if (lastPacket) {
    if (lastPacket.isDownloadingMetadata || lastPacket.isReconnecting) {
      return { phase: "preparing", progress: null, games };
    }

    const progress = lastPacket.isRecovering
      ? (lastPacket.recoveryProgress ?? 0)
      : lastPacket.progress;

    return { phase: "downloading", progress, games };
  }

  if (extraction) {
    return { phase: "extracting", progress: extraction.progress, games };
  }

  const active = tracked.find((game) => isActiveLikeDownload(game.download!));

  if (
    active?.download?.extracting ||
    active?.download?.status === "extracting"
  ) {
    return {
      phase: "extracting",
      progress: active.download.extractionProgress ?? null,
      games,
    };
  }

  if (active) {
    // Started, but the downloader has not reported progress yet.
    return { phase: "preparing", progress: null, games };
  }

  // Pausing the running game starts the next one, so games still queued with
  // nothing running mean the queue itself stopped. Downloads the user paused
  // or that failed are left out: they could sit there for weeks.
  if (queued.length === 0) return IDLE;

  const queuePosition = new Map(queueOrder.map((id, index) => [id, index]));
  const position = (game: LibraryGame) =>
    queuePosition.get(getDownloadId(game.download!)) ?? Infinity;

  // Same order as the Downloads page: queue order first, then oldest first.
  const [head] = [...queued].sort((left, right) => {
    if (position(left) !== position(right)) {
      return position(left) - position(right);
    }

    return (left.download!.timestamp ?? 0) - (right.download!.timestamp ?? 0);
  });

  return {
    phase: "paused",
    progress: head.download!.progress,
    games: queued.length,
  };
}
