import { useEffect, useRef, useState } from "react";
import type { LibraryGame } from "@types";
import { getFinishedDownload } from "@shared";

export function useDownloadFolderExists(game: LibraryGame | null | undefined) {
  const [folderExists, setFolderExists] = useState<boolean | null>(null);
  const gameRef = useRef(game);
  gameRef.current = game;

  const download = getFinishedDownload(game);
  const requestKey = download
    ? `${game?.shop}:${game?.objectId}:${download.folderName}:${download.extracting}`
    : null;

  useEffect(() => {
    const electron = globalThis.window?.electron;
    const currentGame = gameRef.current;
    setFolderExists(null);

    if (!requestKey || !currentGame || !electron) {
      setFolderExists(null);
      return;
    }

    let cancelled = false;

    void electron
      .hasDownloadFolder(currentGame.shop, currentGame.objectId)
      .catch(() => true)
      .then((exists) => {
        if (!cancelled) setFolderExists(exists);
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  return folderExists;
}
