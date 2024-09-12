import internal from "node:stream";
import { client } from "@types";

export interface StartDownloadPayload {
  game_id: number;
  magnet: string;
  save_path: string;
  torrent_client: client | null;
}

export interface PauseDownloadPayload {
  game_id: number;
}

export interface CancelDownloadPayload {
  game_id: number;
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
  bytesDownloaded: number;
  fileSize: number;
  folderName: string;
  status: LibtorrentStatus;
  gameId: number;
}

export interface ProcessPayload {
  exe: string;
  pid: number;
}
