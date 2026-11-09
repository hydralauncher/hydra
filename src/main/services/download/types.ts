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
  CheckingResumeData = 7,
}

export const isVerifyingStatus = (
  status: LibtorrentStatus | number
): boolean => {
  return (
    status === LibtorrentStatus.CheckingFiles ||
    status === LibtorrentStatus.CheckingResumeData
  );
};

export const isQueueVerifyCandidate = (download: {
  bytesDownloaded?: number | null;
  folderName?: string | null;
  fileIndices?: number[] | null;
}): download is {
  bytesDownloaded?: number | null;
  folderName: string;
  fileIndices?: number[] | null;
} => {
  return (download.bytesDownloaded ?? 0) <= 0 && !!download.folderName;
};

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
  parentPid?: number | null;
  name: string;
  environ?: Record<string, string> | null;
  cwd?: string | null;
}

export interface PauseSeedingPayload {
  game_id: number;
}

export interface ResumeSeedingPayload {
  game_id: number;
}
