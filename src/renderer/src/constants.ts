import { Downloader } from "@shared";

export const VERSION_CODENAME = "Spectre";

export const DOWNLOADER_NAME = {
  [Downloader.RealDebrid]: "Real-Debrid",
  [Downloader.Torrent]: "Torrent",
  [Downloader.Gofile]: "Gofile",
  [Downloader.PixelDrain]: "PixelDrain",
  [Downloader.Qiwi]: "Qiwi",
  [Downloader.Datanodes]: "Datanodes",
  [Downloader.Mediafire]: "Mediafire",
  [Downloader.TorBox]: "TorBox",
};

export const MAX_MINUTES_TO_SHOW_IN_PLAYTIME = 120;
