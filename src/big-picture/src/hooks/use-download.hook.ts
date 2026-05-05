import { useCallback, useEffect, useState } from "react";
import { IS_DESKTOP } from "../constants";
import type { DownloadProgress, SeedingStatus, GameShop } from "@types";

export function useDownload() {
  const [lastPacket, setLastPacket] = useState<DownloadProgress | null>(null);
  const [seedingStatus, setSeedingStatus] = useState<SeedingStatus[]>([]);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    const unsubscribeProgress = globalThis.window.electron.onDownloadProgress(
      (downloadProgress) => {
        setLastPacket(downloadProgress);
      }
    );

    const unsubscribeSeeding = globalThis.window.electron.onSeedingStatus(
      (value) => setSeedingStatus(value)
    );

    return () => {
      unsubscribeProgress();
      unsubscribeSeeding();
    };
  }, []);

  const pauseSeeding = useCallback(async (shop: GameShop, objectId: string) => {
    if (!IS_DESKTOP) return;
    await globalThis.window.electron.pauseGameSeed(shop, objectId);
  }, []);

  const resumeSeeding = useCallback(
    async (shop: GameShop, objectId: string) => {
      if (!IS_DESKTOP) return;
      await globalThis.window.electron.resumeGameSeed(shop, objectId);
    },
    []
  );

  const cancelDownload = useCallback(
    async (shop: GameShop, objectId: string) => {
      if (!IS_DESKTOP) return;
      await globalThis.window.electron.cancelGameDownload(shop, objectId);
    },
    []
  );

  const pauseDownload = useCallback(
    async (shop: GameShop, objectId: string) => {
      if (!IS_DESKTOP) return;
      await globalThis.window.electron.pauseGameDownload(shop, objectId);
    },
    []
  );

  const resumeDownload = useCallback(
    async (shop: GameShop, objectId: string) => {
      if (!IS_DESKTOP) return;
      await globalThis.window.electron.resumeGameDownload(shop, objectId);
    },
    []
  );

  return {
    lastPacket,
    seedingStatus,
    pauseSeeding,
    resumeSeeding,
    cancelDownload,
    pauseDownload,
    resumeDownload,
  };
}
