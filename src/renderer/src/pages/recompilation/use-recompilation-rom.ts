import { useCallback, useEffect, useState } from "react";
import type { RecompilationRomSource, RecompilationRomState } from "@types";

import { useAppSelector } from "@renderer/hooks";

/**
 * After a download ends, Hydra registers the extracted ROM as the game's disc
 * a moment later, so the ROM is looked up again after these delays.
 */
const ROM_REFRESH_DELAYS_AFTER_DOWNLOAD_MS = [1500, 4000];

export interface RecompilationRom {
  state: RecompilationRomState | null;
  /** Progress (0 to 1) of the base game's download, while it runs. */
  downloadProgress: number | null;
  /** What that download is doing, or null when none is running. */
  downloadPhase: "downloading" | "extracting" | null;
  refresh: () => Promise<void>;
  choose: (source: RecompilationRomSource, path?: string) => Promise<boolean>;
}

/**
 * The ROM a port will be started with, and the base game's download when the
 * ROM comes from Hydra. Refreshes when that download ends.
 */
export function useRecompilationRom(
  objectId: string,
  slug: string
): RecompilationRom {
  const [state, setState] = useState<RecompilationRomState | null>(null);
  const lastPacket = useAppSelector((store) => store.download.lastPacket);
  const library = useAppSelector((store) => store.library.value);

  const gameId = `launchbox:${objectId}`;
  // Progress packets stop between the download and its extraction, so the
  // library entry also says whether the download is still going.
  const download = library.find((game) => game.id === gameId)?.download;
  const packetProgress =
    lastPacket?.gameId === gameId ? lastPacket.progress : null;
  const isExtracting = download?.extracting === true;
  const downloadPhase = isExtracting
    ? "extracting"
    : packetProgress !== null || download?.status === "active"
      ? "downloading"
      : null;
  const downloadProgress =
    downloadPhase === "extracting"
      ? (download?.extractionProgress ?? 0)
      : downloadPhase === "downloading"
        ? (packetProgress ?? download?.progress ?? 0)
        : null;
  const isDownloading = downloadPhase !== null;

  const refresh = useCallback(async () => {
    setState(
      await window.electron.getRecompilationRomState({ objectId, slug })
    );
  }, [objectId, slug]);

  useEffect(() => {
    setState(null);
    void refresh();
  }, [refresh]);

  // A finished download or a disc change shows up in the library.
  useEffect(() => {
    if (!isDownloading) void refresh();
  }, [isDownloading, library, refresh]);

  // The download reports done before Hydra registers the extracted ROM as the
  // game's disc, so look again a little after it ends.
  useEffect(() => {
    if (isDownloading) return;
    const timeouts = ROM_REFRESH_DELAYS_AFTER_DOWNLOAD_MS.map((delay) =>
      window.setTimeout(() => void refresh(), delay)
    );
    return () => timeouts.forEach((timeout) => window.clearTimeout(timeout));
  }, [isDownloading, refresh]);

  const choose = useCallback(
    async (source: RecompilationRomSource, path?: string) => {
      const result = await window.electron.setRecompilationRom(
        { objectId, slug },
        { source, path }
      );
      await refresh();
      return result.ok;
    },
    [objectId, slug, refresh]
  );

  return { state, downloadProgress, downloadPhase, refresh, choose };
}
