import { addMilliseconds } from "date-fns";

import {
  clearDownload,
  removeGameFromDeleting,
  setGameDeleting,
  setLastPacket,
} from "@renderer/features";
import { formatDownloadProgress } from "@renderer/helpers";
import { formatBytes } from "@renderer/utils";
import type { GameShop, TorrentProgress } from "@types";
import { useAppDispatch, useAppSelector } from "./redux";
import { useDate } from "./use-date";

export function useDownload() {
  const { updateLibrary } = useLibrary();
  const { formatDistance } = useDate();

  const { lastPacket, gamesWithDeletionInProgress } = useAppSelector(
    (state) => state.download
  );
  const dispatch = useAppDispatch();

  const startDownload = (
    repackId: number,
    objectID: string,
    title: string,
    shop: GameShop,
    downloadPath: string
  ) =>
    window.electron
      .startGameDownload(repackId, objectID, title, shop, downloadPath)
      .then((game) => {
        dispatch(clearDownload());
        updateLibrary();

        return game;
      });

  const pauseDownload = (gameId: number) =>
    window.electron.pauseGameDownload(gameId).then(() => {
      dispatch(clearDownload());
      updateLibrary();
    });

  const resumeDownload = (gameId: number) =>
    window.electron.resumeGameDownload(gameId).then(() => {
      updateLibrary();
    });

  const cancelDownload = (gameId: number) =>
    window.electron.cancelGameDownload(gameId).then(() => {
      dispatch(clearDownload());
      updateLibrary();
      deleteGame(gameId);
    });

  const removeGameFromLibrary = (gameId: number) =>
    window.electron.removeGameFromLibrary(gameId).then(() => {
      updateLibrary();
    });

  const isVerifying = GameStatusHelper.isVerifying(
    lastPacket?.game.status ?? null
  );

  const getETA = () => {
    if (isVerifying || !isFinite(lastPacket?.timeRemaining ?? 0)) {
      return "";
    }

    try {
      return formatDistance(
        addMilliseconds(new Date(), lastPacket?.timeRemaining ?? 1),
        new Date(),
        { addSuffix: true }
      );
    } catch (err) {
      return "";
    }
  };

  const getProgress = () => {
    if (lastPacket?.game.status === GameStatus.CheckingFiles) {
      return formatDownloadProgress(lastPacket?.game.fileVerificationProgress);
    }

    return formatDownloadProgress(lastPacket?.game.progress);
  };

  const deleteGame = (gameId: number) =>
    window.electron
      .cancelGameDownload(gameId)
      .then(() => {
        dispatch(setGameDeleting(gameId));
        return window.electron.deleteGameFolder(gameId);
      })
      .finally(() => {
        updateLibrary();
        dispatch(removeGameFromDeleting(gameId));
      });

  const removeInstallationFolder = (gameId: number) => {
    window.electron.deleteGameFolder(gameId).finally(() => {
      updateLibrary();
    });
  };

  const isGameDeleting = (gameId: number) => {
    return gamesWithDeletionInProgress.includes(gameId);
  };

  return {
    game: lastPacket?.game,
    bytesDownloaded: lastPacket?.game.bytesDownloaded,
    fileSize: lastPacket?.game.fileSize,
    isVerifying,
    gameId: lastPacket?.game.id,
    downloadSpeed: `${formatBytes(lastPacket?.downloadSpeed ?? 0)}/s`,
    progress: getProgress(),
    numPeers: lastPacket?.numPeers,
    numSeeds: lastPacket?.numSeeds,
    eta: getETA(),
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    removeGameFromLibrary,
    deleteGame,
    removeInstallationFolder,
    isGameDeleting,
    clearDownload: () => dispatch(clearDownload()),
    setLastPacket: (packet: TorrentProgress) => dispatch(setLastPacket(packet)),
  };
}
