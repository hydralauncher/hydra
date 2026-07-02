import { Downloader } from "@shared";

export const IS_BROWSER =
  globalThis.self !== undefined &&
  globalThis.Window !== undefined &&
  globalThis.self instanceof globalThis.Window;

export const IS_DESKTOP = IS_BROWSER && !!globalThis.window.electron;

export const MAX_OVERLAY_Z_INDEX = 2_147_483_647;

export const DOWNLOADER_NAME: Record<Downloader, string> = {
  [Downloader.RealDebrid]: "Real-Debrid",
  [Downloader.Torrent]: "Torrent",
  [Downloader.Gofile]: "Gofile",
  [Downloader.PixelDrain]: "PixelDrain",
  [Downloader.Datanodes]: "Datanodes",
  [Downloader.Mediafire]: "Mediafire",
  [Downloader.TorBox]: "TorBox",
  [Downloader.Hydra]: "Nimbus",
  [Downloader.FuckingFast]: "FuckingFast",
  [Downloader.VikingFile]: "VikingFile",
  [Downloader.Rootz]: "Rootz",
  [Downloader.Premiumize]: "Premiumize",
  [Downloader.AllDebrid]: "AllDebrid",
};
