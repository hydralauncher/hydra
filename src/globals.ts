export enum GameStatus {
  Seeding = "seeding",
  Downloading = "downloading",
  Paused = "paused",
  CheckingFiles = "checking_files",
  DownloadingMetadata = "downloading_metadata",
  Cancelled = "cancelled",
  Finished = "finished",
  Decompressing = "decompressing",
}

export namespace GameStatus {
  export const isDownloading = (status: GameStatus | null) =>
    status === GameStatus.Downloading ||
    status === GameStatus.DownloadingMetadata ||
    status === GameStatus.CheckingFiles;

  export const isVerifying = (status: GameStatus | null) =>
    GameStatus.DownloadingMetadata == status ||
    GameStatus.CheckingFiles == status ||
    GameStatus.Decompressing == status;

  export const isReady = (status: GameStatus | null) =>
    status === GameStatus.Finished || status === GameStatus.Seeding;
}
