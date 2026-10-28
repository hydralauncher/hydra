import type { Download, LibraryGame } from "@types";
import { Downloader, FILE_EXTENSIONS_TO_EXTRACT } from "./constants.js";

export type FinishedDownloadStep =
  | "extracting"
  | "extract"
  | "play"
  | "installing"
  | "install"
  | "select-executable";

export const getFinishedDownload = (
  game: LibraryGame | null | undefined
): Download | null => {
  const download = game?.download;

  if (download?.progress !== 1) return null;
  if (download.downloader === Downloader.Epic) return null;

  return download;
};

export const isUnextractedArchive = (download: Download) => {
  const folderName = download.folderName?.toLowerCase();

  return (
    !!folderName &&
    FILE_EXTENSIONS_TO_EXTRACT.some((extension) =>
      folderName.endsWith(extension)
    )
  );
};

export const getFinishedDownloadStep = (
  game: LibraryGame,
  hasInstaller: boolean
): FinishedDownloadStep | null => {
  const download = getFinishedDownload(game);

  if (!download) return null;
  if (download.extracting) return "extracting";
  if (game.executablePath) return "play";
  if (game.shop === "launchbox") {
    return (game.discs?.length ?? 0) > 0 ? "play" : null;
  }
  if (isUnextractedArchive(download)) return "extract";
  if (download.installerRunning) return "installing";
  if (hasInstaller && !download.installerLaunched) return "install";

  return "select-executable";
};
