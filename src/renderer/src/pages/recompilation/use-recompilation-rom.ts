import { useCallback, useEffect, useState } from "react";
import type {
  RecompilationActionResult,
  RecompilationRomSource,
  RecompilationRomState,
} from "@types";

import { useAppSelector } from "@renderer/hooks";

const ROM_REFRESH_DELAYS_AFTER_DOWNLOAD_MS = [1500, 4000];

export interface RecompilationRom {
  state: RecompilationRomState | null;
  downloadProgress: number | null;
  downloadPhase: "downloading" | "extracting" | null;
  refresh: () => Promise<void>;
  choose: (
    source: RecompilationRomSource,
    path?: string
  ) => Promise<RecompilationActionResult>;
}

export function useRecompilationRom(
  objectId: string,
  slug: string
): RecompilationRom {
  const [state, setState] = useState<RecompilationRomState | null>(null);
  const lastPacket = useAppSelector((store) => store.download.lastPacket);
  const library = useAppSelector((store) => store.library.value);
  const pkgJob = useAppSelector((store) => store.ps4PkgJob.job);

  const gameId = `launchbox:${objectId}`;
  const download = library.find((game) => game.id === gameId)?.download;
  const packetProgress =
    lastPacket?.gameId === gameId ? lastPacket.progress : null;
  let downloadPhase: RecompilationRom["downloadPhase"] = null;
  let downloadProgress: number | null = null;
  // A PKG for this game extracts like a downloaded ROM does.
  if (pkgJob?.shop === "launchbox" && pkgJob.objectId === objectId) {
    downloadPhase = "extracting";
    downloadProgress = pkgJob.progress;
  } else if (download?.extracting === true) {
    downloadPhase = "extracting";
    downloadProgress = download.extractionProgress ?? 0;
  } else if (packetProgress !== null || download?.status === "active") {
    downloadPhase = "downloading";
    downloadProgress = packetProgress ?? download?.progress ?? 0;
  }
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

  useEffect(() => {
    if (!isDownloading) void refresh();
  }, [isDownloading, library, refresh]);

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
      return result;
    },
    [objectId, slug, refresh]
  );

  return { state, downloadProgress, downloadPhase, refresh, choose };
}
