import { addMilliseconds } from "date-fns";

import { formatDownloadProgress } from "@renderer/helpers";
import { useLibrary } from "./use-library";
import { useAppDispatch, useAppSelector } from "./redux";
import {
  setLastPacket,
  clearDownload,
  setGameDeleting,
  removeGameFromDeleting,
} from "@renderer/features";
import type { DownloadProgress, StartGameDownloadPayload } from "@types";
import { useDate } from "./use-date";
import { formatBytes } from "@shared";

export function useDownload() {
  const { updateLibrary } = useLibrary();
  const { formatDistance } = useDate();

  const { lastPacket, gamesWithDeletionInProgress } = useAppSelector(
    (state) => state.download
  );
  const dispatch = useAppDispatch();

  const startDownload = async (payload: StartGameDownloadPayload) => {
    dispatch(clearDownload());

    const game = await window.electron.startGameDownload(payload);

    await updateLibrary();
    return game;
  };

  const pauseDownload = async (gameId: number) => {
    await window.electron.pauseGameDownload(gameId);
    await updateLibrary();
    dispatch(clearDownload());
  };

  const resumeDownload = async (gameId: number) => {
    await window.electron.resumeGameDownload(gameId);
    return updateLibrary();
  };

  const removeGameInstaller = async (gameId: number) => {
    dispatch(setGameDeleting(gameId));

    try {
      await window.electron.deleteGameFolder(gameId);
      updateLibrary();
    } finally {
      dispatch(removeGameFromDeleting(gameId));
    }
  };

  const cancelDownload = async (gameId: number) => {
    await window.electron.cancelGameDownload(gameId);
    dispatch(clearDownload());
    updateLibrary();

    removeGameInstaller(gameId);
  };

  const removeGameFromLibrary = (gameId: number) =>
    window.electron.removeGameFromLibrary(gameId).then(() => {
      updateLibrary();
    });

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

  const isGameDeleting = (gameId: number) => {
    return gamesWithDeletionInProgress.includes(gameId);
  };

  return {
    downloadSpeed: `${formatBytes(lastPacket?.downloadSpeed ?? 0)}/s`,
    progress: formatDownloadProgress(lastPacket?.progress ?? 0),
    lastPacket,
    eta: calculateETA(),
    startDownload,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    removeGameFromLibrary,
    removeGameInstaller,
    isGameDeleting,
    clearDownload: () => dispatch(clearDownload()),
    setLastPacket: (packet: DownloadProgress) =>
      dispatch(setLastPacket(packet)),
  };
}
