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
import type {
  DownloadProgress,
  GameShop,
  StartGameDownloadPayload,
} from "@types";
import { useDate } from "./use-date";
import { formatBytes, formatBytesToMbps } from "@shared";

export function useDownload() {
  const { updateLibrary } = useLibrary();
  const { formatDistance } = useDate();

  const userPrefs = useAppSelector((state) => state.userPreferences.value);

  const { lastPacket, gamesWithDeletionInProgress } = useAppSelector(
    (state) => state.download
  );
  const dispatch = useAppDispatch();

  const startDownload = async (payload: StartGameDownloadPayload) => {
    dispatch(clearDownload());

    const response = await window.electron.startGameDownload(payload);

    if (response.ok) updateLibrary();

    return response;
  };

  const pauseDownload = async (shop: GameShop, objectId: string) => {
    await window.electron.pauseGameDownload(shop, objectId);
    await updateLibrary();
    if (lastPacket?.gameId === `${shop}:${objectId}`) dispatch(clearDownload());
  };

  const resumeDownload = async (shop: GameShop, objectId: string) => {
    await window.electron.resumeGameDownload(shop, objectId);
    return updateLibrary();
  };

  const removeGameInstaller = async (shop: GameShop, objectId: string) => {
    dispatch(setGameDeleting(objectId));

    try {
      await window.electron.deleteGameFolder(shop, objectId);
      updateLibrary();
    } finally {
      dispatch(removeGameFromDeleting(objectId));
    }
  };

  const cancelDownload = async (shop: GameShop, objectId: string) => {
    await window.electron.cancelGameDownload(shop, objectId);
    dispatch(clearDownload());
    updateLibrary();

    removeGameInstaller(shop, objectId);
  };

  const removeGameFromLibrary = (shop: GameShop, objectId: string) =>
    window.electron.removeGameFromLibrary(shop, objectId).then(() => {
      updateLibrary();
    });

  const pauseSeeding = async (shop: GameShop, objectId: string) => {
    await window.electron.pauseGameSeed(shop, objectId);
    await updateLibrary();
  };

  const resumeSeeding = async (shop: GameShop, objectId: string) => {
    await window.electron.resumeGameSeed(shop, objectId);
    await updateLibrary();
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

  const isGameDeleting = (objectId: string) => {
    return gamesWithDeletionInProgress.includes(objectId);
  };

  const formatDownloadSpeed = (downloadSpeed: number): string => {
    return userPrefs?.showDownloadSpeedInMegabits
      ? `${formatBytes(downloadSpeed)}/s`
      : formatBytesToMbps(downloadSpeed);
  };

  return {
    downloadSpeed: formatDownloadSpeed(lastPacket?.downloadSpeed ?? 0),
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
    pauseSeeding,
    resumeSeeding,
    clearDownload: () => dispatch(clearDownload()),
    setLastPacket: (packet: DownloadProgress | null) =>
      dispatch(setLastPacket(packet)),
  };
}
