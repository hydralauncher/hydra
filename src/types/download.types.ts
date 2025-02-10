import type { Download } from "./level.types";

export type DownloadStatus =
  | "active"
  | "waiting"
  | "paused"
  | "error"
  | "complete"
  | "seeding"
  | "removed";

export interface DownloadProgress {
  downloadSpeed: number;
  timeRemaining: number;
  numPeers: number;
  numSeeds: number;
  isDownloadingMetadata: boolean;
  isCheckingFiles: boolean;
  progress: number;
  gameId: string;
  download: Download;
}

/* Torbox */
export interface TorBoxUser {
  id: number;
  email: string;
  plan: string;
  expiration: string;
}

export interface TorBoxUserRequest {
  success: boolean;
  detail: string;
  error: string;
  data: TorBoxUser;
}

export interface TorBoxFile {
  id: number;
  md5: string;
  s3_path: string;
  name: string;
  size: number;
  mimetype: string;
  short_name: string;
}

export interface TorBoxTorrentInfo {
  id: number;
  hash: string;
  created_at: string;
  updated_at: string;
  magnet: string;
  size: number;
  active: boolean;
  cached: boolean;
  auth_id: string;
  download_state:
    | "downloading"
    | "uploading"
    | "stalled (no seeds)"
    | "paused"
    | "completed"
    | "cached"
    | "metaDL"
    | "checkingResumeData";
  seeds: number;
  ratio: number;
  progress: number;
  download_speed: number;
  upload_speed: number;
  name: string;
  eta: number;
  files: TorBoxFile[];
}

export interface TorBoxTorrentInfoRequest {
  success: boolean;
  detail: string;
  error: string;
  data: TorBoxTorrentInfo[];
}

export interface TorBoxAddTorrentRequest {
  success: boolean;
  detail: string;
  error: string;
  data: {
    torrent_id: number;
    name: string;
    hash: string;
  };
}

export interface TorBoxRequestLinkRequest {
  success: boolean;
  detail: string;
  error: string;
  data: string;
}

/* Real-Debrid */
export interface RealDebridUnrestrictLink {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  host_icon: string;
  chunks: number;
  crc: number;
  download: string;
  streamable: number;
}

export interface RealDebridAddMagnet {
  id: string;
  // URL of the created resource
  uri: string;
}

export interface RealDebridTorrentInfo {
  id: string;
  filename: string;
  original_filename: string;
  hash: string;
  bytes: number;
  original_bytes: number;
  host: string;
  split: number;
  progress: number;
  status:
    | "magnet_error"
    | "magnet_conversion"
    | "waiting_files_selection"
    | "queued"
    | "downloading"
    | "downloaded"
    | "error"
    | "virus"
    | "compressing"
    | "uploading"
    | "dead";
  added: string;
  files: {
    id: number;
    path: string;
    bytes: number;
    selected: number;
  }[];
  links: string[];
  ended: string;
  speed: number;
  seeders: number;
}

export interface RealDebridUser {
  id: number;
  username: string;
  email: string;
  points: number;
  locale: string;
  avatar: string;
  type: string;
  premium: number;
  expiration: string;
}

/* Torrent */
export interface SeedingStatus {
  gameId: string;
  status: DownloadStatus;
  uploadSpeed: number;
}

/* All-Debrid */
export interface AllDebridUser {
  username: string;
  email: string;
  isPremium: boolean;
  premiumUntil: string;
}