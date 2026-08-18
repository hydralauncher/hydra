import { useEffect, useState } from "react";
import type { GameRepack } from "@types";
import { useDownload } from "@renderer/hooks";
import { Downloader, getDownloadersForUri } from "@shared";
import { RepacksModal } from "@renderer/pages/game-details/modals/repacks-modal";
import { levelDBService } from "@renderer/services/leveldb.service";
import { orderBy } from "lodash-es";
import { gameDetailsContext } from "@renderer/context";

export interface DownloadGameModalProps {
  visible: boolean;
  game: {
    objectId: string;
    shop: any;
    title: string;
    executablePath?: string | null;
  } | null;
  onClose: () => void;
}

export function DownloadGameModal({
  visible,
  game,
  onClose,
}: Readonly<DownloadGameModalProps>) {
  const [repacks, setRepacks] = useState<GameRepack[]>([]);
  const { startDownload, addGameToQueue } = useDownload();

  useEffect(() => {
    if (!visible || !game || game.shop === "custom") return;

    const fetchDownloadSources = async () => {
      try {
        const sourcesRaw = (await levelDBService.values(
          "downloadSources"
        )) as any[];
        const sources = orderBy(sourcesRaw, "createdAt", "desc");

        const params = {
          take: 100,
          skip: 0,
          downloadSourceIds: sources.map((source) => source.id),
        };

        const downloads = await window.electron.hydraApi.get<GameRepack[]>(
          `/games/${game.shop}/${game.objectId}/download-sources`,
          {
            params,
            needsAuth: false,
          }
        );

        setRepacks(downloads);
      } catch (error) {
        console.error("Failed to fetch download sources:", error);
      }
    };

    fetchDownloadSources();
  }, [visible, game]);

  const selectRepackUri = (repack: GameRepack, downloader: Downloader) => {
    const matched = repack.uris.find((uri) =>
      getDownloadersForUri(uri).includes(downloader)
    );
    return matched || repack.uris[0] || "";
  };

  const handleStartDownload = async (
    repack: GameRepack,
    downloader: Downloader,
    downloadPath: string,
    automaticallyExtract: boolean,
    addToQueueOnly = false,
    fileIndices?: number[],
    selectedFilesSize?: number | null,
    automaticallyDeleteArchiveFiles = false
  ) => {
    if (!game) return { ok: false };

    const response = addToQueueOnly
      ? await addGameToQueue({
          objectId: game.objectId,
          title: game.title,
          downloader,
          shop: game.shop,
          downloadPath,
          uri: selectRepackUri(repack, downloader),
          automaticallyExtract,
          automaticallyDeleteArchiveFiles,
          fileSize: repack.fileSize,
          fileIndices,
          selectedFilesSize,
        })
      : await startDownload({
          objectId: game.objectId,
          title: game.title,
          downloader,
          shop: game.shop,
          downloadPath,
          uri: selectRepackUri(repack, downloader),
          automaticallyExtract,
          automaticallyDeleteArchiveFiles,
          fileSize: repack.fileSize,
          fileIndices,
          selectedFilesSize,
        });

    if (response.ok) {
      window.electron.getGameByObjectId(game.shop, game.objectId);
      onClose();
    }

    return response;
  };

  if (!game || !visible) return null;

  return (
    <gameDetailsContext.Provider
      value={
        {
          game: game as any,
          repacks,
          shop: game.shop,
          objectId: game.objectId,
          title: game.title,
        } as any
      }
    >
      <RepacksModal
        visible={visible}
        startDownload={handleStartDownload}
        onClose={onClose}
      />
    </gameDetailsContext.Provider>
  );
}
