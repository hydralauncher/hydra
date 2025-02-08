import { Downloader } from "@shared";

export const DOWNLOADER_NAME: Record<Downloader, string> = {
  [Downloader.Gofile]: "Gofile",
  [Downloader.PixelDrain]: "PixelDrain",
  [Downloader.Qiwi]: "Qiwi",
  [Downloader.Datanodes]: "Datanodes",
  [Downloader.Mediafire]: "Mediafire",
  [Downloader.Torrent]: "Torrent",
  [Downloader.RealDebrid]: "Real-Debrid",
  [Downloader.AllDebrid]: "All-Debrid",
  [Downloader.TorBox]: "TorBox",
}; 