export interface PauseDownloadPayload {
  game_id: string;
}

export interface CancelDownloadPayload {
  game_id: string;
}

export enum LibtorrentStatus {
  CheckingFiles = 1,
  DownloadingMetadata = 2,
  Downloading = 3,
  Finished = 4,
  Seeding = 5,
}

export interface LibtorrentPayload {
  progress: number;
  numPeers: number;
  numSeeds: number;
  downloadSpeed: number;
  uploadSpeed: number;
  bytesDownloaded: number;
  fileSize: number;
  folderName: string;
  status: LibtorrentStatus;
  gameId: string;
}

export interface ProcessPayload {
  exe: string | null;
  pid: number;
  name: string;
  environ: Record<string, string> | null;
  cwd: string | null;
}

export interface PauseSeedingPayload {
  game_id: number;
}

export interface ResumeSeedingPayload {
  game_id: number;
}
