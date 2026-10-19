import type { Download, LibraryGame } from "@types";
import { Downloader } from "./constants.js";

export type FinishedDownloadStep =
  | "extracting"
  | "play"
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

export const getFinishedDownloadStep = (
  game: LibraryGame,
  hasInstaller: boolean
): FinishedDownloadStep | null => {
  const download = getFinishedDownload(game);

  if (!download) return null;
  if (download.extracting) return "extracting";
  if (game.executablePath) return "play";
  if (hasInstaller && !download.installerLaunched) return "install";

  return "select-executable";
};
