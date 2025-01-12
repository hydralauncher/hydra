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
  error: string | null;
  data: TorBoxTorrentInfo[];
}

export interface TorBoxAddTorrentRequest {
  success: boolean;
  detail: string;
  error: string | null;
  data: {
    torrent_id: number;
    name: string;
    hash: string;
    size: number;
  };
}

export interface TorBoxRequestLinkRequest {
  success: boolean;
  detail: string;
  error: string;
  data: string;
}
