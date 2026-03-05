import { AxiosError } from "axios";
import { Downloader, DownloadError } from "@shared";

type DownloadErrorResult = { ok: false; error?: string };
const KNOWN_DOWNLOAD_ERRORS = new Set<string>(Object.values(DownloadError));

const handleAxiosError = (
  err: AxiosError,
  downloader: Downloader
): DownloadErrorResult | null => {
  if (err.response?.status === 429 && downloader === Downloader.Gofile) {
    return { ok: false, error: DownloadError.GofileQuotaExceeded };
  }

  if (err.response?.status === 403 && downloader === Downloader.RealDebrid) {
    return { ok: false, error: DownloadError.RealDebridAccountNotAuthorized };
  }

  if (
    (err.response?.status === 401 || err.response?.status === 403) &&
    downloader === Downloader.Premiumize
  ) {
    return { ok: false, error: DownloadError.PremiumizeAccountNotAuthorized };
  }

  if (
    (err.response?.status === 401 || err.response?.status === 403) &&
    downloader === Downloader.AllDebrid
  ) {
    return { ok: false, error: DownloadError.AllDebridAccountNotAuthorized };
  }

  if (err.response?.status === 429 && downloader === Downloader.Premiumize) {
    return { ok: false, error: DownloadError.PremiumizeRateLimitExceeded };
  }

  if (err.response?.status === 429 && downloader === Downloader.AllDebrid) {
    return { ok: false, error: DownloadError.AllDebridRateLimitExceeded };
  }

  if (err.response?.status === 503 && downloader === Downloader.Premiumize) {
    return { ok: false, error: DownloadError.PremiumizeUnavailable };
  }

  if (err.response?.status === 503 && downloader === Downloader.AllDebrid) {
    return { ok: false, error: DownloadError.AllDebridUnavailable };
  }

  if (downloader === Downloader.TorBox) {
    const data = err.response?.data as { detail?: string } | undefined;
    return { ok: false, error: data?.detail };
  }

  return null;
};

const HOST_NAMES: Partial<Record<Downloader, string>> = {
  [Downloader.Buzzheavier]: "Buzzheavier",
  [Downloader.FuckingFast]: "FuckingFast",
};

const handleHostSpecificError = (
  message: string,
  downloader: Downloader
): DownloadErrorResult | null => {
  const hostName = HOST_NAMES[downloader];
  if (!hostName) return null;

  if (message.includes("Rate limit")) {
    return { ok: false, error: `${hostName}: Rate limit exceeded` };
  }

  if (message.includes("not found") || message.includes("deleted")) {
    return { ok: false, error: `${hostName}: File not found` };
  }

  return null;
};

export const handleDownloadError = (
  err: unknown,
  downloader: Downloader
): DownloadErrorResult => {
  if (err instanceof AxiosError) {
    const result = handleAxiosError(err, downloader);
    if (result) return result;
  }

  if (err instanceof Error) {
    const hostResult = handleHostSpecificError(err.message, downloader);
    if (hostResult) return hostResult;

    return { ok: false, error: err.message };
  }

  return { ok: false };
};

export const isKnownDownloadError = (err: unknown) => {
  return err instanceof Error && KNOWN_DOWNLOAD_ERRORS.has(err.message);
};
