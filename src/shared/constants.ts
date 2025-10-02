export enum Downloader {
  RealDebrid,
  AllDebrid,
  Torrent,
  Gofile,
  PixelDrain,
  Qiwi,
  Datanodes,
  Mediafire,
  TorBox,
  Hydra,
}

export enum DownloadSourceStatus {
  UpToDate,
  Errored,
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
  NotCachedInAllDebrid = "download_error_not_cached_in_alldebrid",
  NotCachedOnTorBox = "download_error_not_cached_on_torbox",
  GofileQuotaExceeded = "download_error_gofile_quota_exceeded",
  RealDebridAccountNotAuthorized = "download_error_real_debrid_account_not_authorized",
  NotCachedOnHydra = "download_error_not_cached_on_hydra",
}

export const FILE_EXTENSIONS_TO_EXTRACT = [".rar", ".zip", ".7z"];
