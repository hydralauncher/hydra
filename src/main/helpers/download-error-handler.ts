import { AxiosError } from "axios";
import { Downloader, DownloadError } from "@shared";

export const handleDownloadError = (
  err: unknown,
  downloader: Downloader
): { ok: false; error?: string } => {
  if (err instanceof AxiosError) {
    if (err.response?.status === 429 && downloader === Downloader.Gofile) {
      return { ok: false, error: DownloadError.GofileQuotaExceeded };
    }

    if (err.response?.status === 403 && downloader === Downloader.RealDebrid) {
      return { ok: false, error: DownloadError.RealDebridAccountNotAuthorized };
    }

    if (downloader === Downloader.TorBox) {
      return { ok: false, error: err.response?.data?.detail };
    }
  }

  if (err instanceof Error) {
    if (downloader === Downloader.Buzzheavier) {
      if (err.message.includes("Rate limit")) {
        return { ok: false, error: "Buzzheavier: Rate limit exceeded" };
      }
      if (
        err.message.includes("not found") ||
        err.message.includes("deleted")
      ) {
        return { ok: false, error: "Buzzheavier: File not found" };
      }
    }

    if (downloader === Downloader.FuckingFast) {
      if (err.message.includes("Rate limit")) {
        return { ok: false, error: "FuckingFast: Rate limit exceeded" };
      }
      if (
        err.message.includes("not found") ||
        err.message.includes("deleted")
      ) {
        return { ok: false, error: "FuckingFast: File not found" };
      }
    }

    return { ok: false, error: err.message };
  }

  return { ok: false };
};
