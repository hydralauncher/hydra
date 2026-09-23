import { DownloadError, Downloader } from "../../../shared/constants.js";

const pendingErrors = new Map<Downloader, ReadonlySet<string>>([
  [Downloader.TorBox, new Set([DownloadError.TorBoxTorrentNotReady])],
  [
    Downloader.RealDebrid,
    new Set([
      DownloadError.NotCachedOnRealDebrid,
      DownloadError.RealDebridTorrentNotReady,
      DownloadError.RealDebridLinksNotReady,
    ]),
  ],
  [
    Downloader.Premiumize,
    new Set([
      DownloadError.NotCachedOnPremiumize,
      DownloadError.PremiumizeTransferStarted,
    ]),
  ],
  [Downloader.AllDebrid, new Set([DownloadError.NotCachedOnAllDebrid])],
]);

export function isDebridPendingError(
  error: unknown,
  downloader: Downloader
): boolean {
  if (!(error instanceof Error)) return false;
  return pendingErrors.get(downloader)?.has(error.message) ?? false;
}
