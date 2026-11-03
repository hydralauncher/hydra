import type { GameRepack } from "@types";
import { Downloader, getDownloadersForUri, getRepackUriParts } from "@shared";

import { GameDetailsContextProvider } from "@renderer/context";
import { useDownload } from "@renderer/hooks";
import { RepacksModal } from "../game-details/modals";

interface RomDownloadModalProps {
  visible: boolean;
  objectId: string;
  gameTitle: string;
  onStarted: () => void;
  onClose: () => void;
}

/**
 * The base game's "Download options", the same modal as on the game page,
 * for getting a port's ROM.
 */
export function RomDownloadModal({
  visible,
  objectId,
  gameTitle,
  onStarted,
  onClose,
}: Readonly<RomDownloadModalProps>) {
  const { startDownload } = useDownload();

  if (!visible) return null;

  const handleStartDownload = async (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string,
    automaticallyExtract: boolean,
    addToQueueOnly = false,
    fileIndices?: number[],
    selectedFilesSize?: number | null,
    automaticallyDeleteArchiveFiles = false,
    signal?: AbortSignal
  ) => {
    const uri = repack.uris.find((candidate) =>
      getDownloadersForUri(candidate).includes(downloader)
    )!;
    const payload = {
      objectId,
      title: gameTitle,
      downloader,
      shop: "launchbox" as const,
      downloadPath,
      uri,
      parts: getRepackUriParts(repack, uri),
      automaticallyExtract,
      automaticallyDeleteArchiveFiles,
      fileSize: repack.fileSize,
      fileIndices,
      selectedFilesSize,
    };

    const response = addToQueueOnly
      ? await window.electron.addGameToQueue(payload)
      : await startDownload(payload, signal);

    if (response.ok) onStarted();
    return response;
  };

  return (
    <GameDetailsContextProvider
      objectId={objectId}
      gameTitle={gameTitle}
      shop="launchbox"
      syncHeaderTitle={false}
    >
      <RepacksModal
        visible
        startDownload={handleStartDownload}
        onClose={onClose}
      />
    </GameDetailsContextProvider>
  );
}
