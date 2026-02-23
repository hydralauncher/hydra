export enum Downloader {
  RealDebrid,
  Torrent,
  Gofile,
  PixelDrain,
  Datanodes,
  Mediafire,
  TorBox,
  Hydra,
  Buzzheavier,
  FuckingFast,
  VikingFile,
  Rootz,
  Premiumize,
  AllDebrid,
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
}

export const FILE_EXTENSIONS_TO_EXTRACT = [".rar", ".zip", ".7z"];
