export enum GameStatus {
  Seeding = "seeding",
  Downloading = "downloading",
  Paused = "paused",
  CheckingFiles = "checking_files",
  DownloadingMetadata = "downloading_metadata",
  Cancelled = "cancelled",
  Decompressing = "decompressing",
  Finished = "finished",
}

export enum Downloader {
  RealDebrid,
  Torrent,
}

const FORMAT = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || isNaN(bytes) || bytes <= 0) {
    return `0 ${FORMAT[0]}`;
  }

  const byteKBase = 1024;

  const base = Math.floor(Math.log(bytes) / Math.log(byteKBase));

  const formatedByte = bytes / byteKBase ** base;

  return `${Math.trunc(formatedByte * 10) / 10} ${FORMAT[base]}`;
};

export class GameStatusHelper {
  public static isDownloading(status: GameStatus | null) {
    return (
      status === GameStatus.Downloading ||
      status === GameStatus.DownloadingMetadata ||
      status === GameStatus.CheckingFiles
    );
  }

  public static isVerifying(status: GameStatus | null) {
    return (
      GameStatus.DownloadingMetadata == status ||
      GameStatus.CheckingFiles == status
    );
  }

  public static isReady(status: GameStatus | null) {
    return status === GameStatus.Finished || status === GameStatus.Seeding;
  }
}
