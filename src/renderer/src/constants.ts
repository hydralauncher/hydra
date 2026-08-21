import { Downloader } from "@shared";

export const DOWNLOADER_NAME = {
  [Downloader.RealDebrid]: "Real-Debrid",
  [Downloader.Torrent]: "Torrent",
  [Downloader.Gofile]: "Gofile",
  [Downloader.PixelDrain]: "PixelDrain",
  [Downloader.Datanodes]: "Datanodes",
  [Downloader.Mediafire]: "Mediafire",
  [Downloader.FuckingFast]: "FuckingFast",
  [Downloader.TorBox]: "TorBox",
  [Downloader.Hydra]: "Nimbus",
  [Downloader.VikingFile]: "VikingFile",
  [Downloader.Rootz]: "Rootz",
  [Downloader.Premiumize]: "Premiumize",
  [Downloader.AllDebrid]: "AllDebrid",
  [Downloader.ArchiveOrg]: "Archive.org",
};

export const MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120;

export const REVIEW_MIN_PLAYTIME_IN_MS = 2 * 60 * 60 * 1000;

export const REVIEW_PROMPT_DISMISS_TTL_IN_MS = 7 * 24 * 60 * 60 * 1000;

export const MAX_DOWNLOAD_SPEED_HISTORY = 300;

export const THEME_WEB_STORE_URL = "https://hydrathemes.shop";
