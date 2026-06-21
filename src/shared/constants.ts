export enum Downloader {
  RealDebrid = 0,
  Torrent = 1,
  Gofile = 2,
  PixelDrain = 3,
  Datanodes = 4,
  Mediafire = 5,
  TorBox = 6,
  Hydra = 7,
  FuckingFast = 9,
  VikingFile = 10,
  Rootz = 11,
  Premiumize = 12,
  AllDebrid = 13,
}

export enum DownloadSourceStatus {
  PendingMatching = "PENDING_MATCHING",
  Matched = "MATCHED",
  Matching = "MATCHING",
  Failed = "FAILED",
}

export enum CatalogueCategory {
  Hot = "hot",
  Weekly = "weekly",
  Achievements = "achievements",
}

export enum SteamContentDescriptor {
  SomeNudityOrSexualContent = 1,
  FrequenceViolenceOrGore = 2,
  AdultOnlySexualContent = 3,
  FrequentNudityOrSexualContent = 4,
  GeneralMatureContent = 5,
}

export enum Cracker {
  codex = "CODEX",
  rune = "RUNE",
  onlineFix = "OnlineFix",
  goldberg = "Goldberg",
  userstats = "user_stats",
  Steam = "Steam",
  rld = "RLD!",
  empress = "EMPRESS",
  skidrow = "SKIDROW",
  creamAPI = "CreamAPI",
  smartSteamEmu = "SmartSteamEmu",
  _3dm = "3dm",
  flt = "FLT",
  rle = "RLE",
  razor1911 = "RAZOR1911",
}

export enum AuthPage {
  SignIn = "/",
  UpdateEmail = "/update-email",
  UpdatePassword = "/update-password",
}

export enum DownloadError {
  NotCachedOnRealDebrid = "download_error_not_cached_on_real_debrid",
  NotCachedOnTorBox = "download_error_not_cached_on_torbox",
  GofileQuotaExceeded = "download_error_gofile_quota_exceeded",
  RealDebridAccountNotAuthorized = "download_error_real_debrid_account_not_authorized",
  NotCachedOnHydra = "download_error_not_cached_on_hydra",
  NotCachedOnPremiumize = "download_error_not_cached_on_premiumize",
  PremiumizeTransferStarted = "download_error_premiumize_transfer_started",
  NotCachedOnAllDebrid = "download_error_not_cached_on_alldebrid",
  PremiumizeAccountNotAuthorized = "download_error_premiumize_account_not_authorized",
  AllDebridAccountNotAuthorized = "download_error_alldebrid_account_not_authorized",
  PremiumizeRateLimitExceeded = "download_error_premiumize_rate_limit_exceeded",
  AllDebridRateLimitExceeded = "download_error_alldebrid_rate_limit_exceeded",
  PremiumizeUnavailable = "download_error_premiumize_unavailable",
  AllDebridUnavailable = "download_error_alldebrid_unavailable",
  VikingFileNimbusQuotaExceeded = "download_error_vikingfile_nimbus_quota_exceeded",
  InvalidMagnet = "download_error_invalid_magnet",
  TorrentMetadataTimeout = "download_error_torrent_metadata_timeout",
  TorrentMetadataIncomplete = "download_error_torrent_metadata_incomplete",
  TorrentNoFilesSelected = "download_error_torrent_no_files_selected",
  TorrentInvalidFileSelection = "download_error_torrent_invalid_file_selection",
  TorrentTooManyFiles = "download_error_torrent_too_many_files",
  TorrentFilesUnavailable = "download_error_torrent_files_unavailable",
}

export const FILE_EXTENSIONS_TO_EXTRACT = [".rar", ".zip", ".7z"];

export const WINDOWS_GAME_EXECUTABLE_EXTENSIONS = ["exe", "lnk", "bat", "cmd"];

export const LINUX_GAME_EXECUTABLE_EXTENSIONS = [
  ...WINDOWS_GAME_EXECUTABLE_EXTENSIONS,
  "AppImage",
  "sh",
  "x86_64",
  "x86",
  "run",
  "bin",
];

export const DARWIN_GAME_EXECUTABLE_EXTENSIONS = ["app"];

export const getGameExecutableFilters = (
  platform: string,
  labels: { executable: string; allFiles: string }
) => {
  if (platform === "linux") {
    return [
      { name: labels.executable, extensions: LINUX_GAME_EXECUTABLE_EXTENSIONS },
      { name: labels.allFiles, extensions: ["*"] },
    ];
  }

  if (platform === "darwin") {
    return [
      {
        name: labels.executable,
        extensions: DARWIN_GAME_EXECUTABLE_EXTENSIONS,
      },
    ];
  }

  return [
    { name: labels.executable, extensions: WINDOWS_GAME_EXECUTABLE_EXTENSIONS },
  ];
};

export const GAMEMODE_SITE_URL = "https://github.com/FeralInteractive/gamemode";
export const MANGOHUD_SITE_URL = "https://github.com/flightlessmango/MangoHud";
