export enum GameStatus {
  Seeding = "seeding",
  Downloading = "downloading",
  Paused = "paused",
  CheckingFiles = "checking_files",
  DownloadingMetadata = "downloading_metadata",
  Cancelled = "cancelled",
  Finished = "finished",
}

export enum Downloader {
  Http,
  Torrent,
}

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
