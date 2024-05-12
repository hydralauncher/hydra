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
  // URL of the created ressource
  uri: string;
}

export interface RealDebridTorrentInfo {
  id: string;
  filename: string;
  original_filename: string; // Original name of the torrent
  hash: string; // SHA1 Hash of the torrent
  bytes: number; // Size of selected files only
  original_bytes: number; // Total size of the torrent
  host: string; // Host main domain
  split: number; // Split size of links
  progress: number; // Possible values: 0 to 100
  status: string; // Current status of the torrent: magnet_error, magnet_conversion, waiting_files_selection, queued, downloading, downloaded, error, virus, compressing, uploading, dead
  added: string; // jsonDate
  files: [
    {
      id: number;
      path: string; // Path to the file inside the torrent, starting with "/"
      bytes: number;
      selected: number; // 0 or 1
    },
    {
      id: number;
      path: string; // Path to the file inside the torrent, starting with "/"
      bytes: number;
      selected: number; // 0 or 1
    },
  ];
  links: string[];
  ended: string; // !! Only present when finished, jsonDate
  speed: number; // !! Only present in "downloading", "compressing", "uploading" status
  seeders: number; // !! Only present in "downloading", "magnet_conversion" status
}
