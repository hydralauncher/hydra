import { AxiosError } from "axios";
import {
  Downloader,
  DownloadError,
  SubscriptionRequiredError,
  UserNotLoggedInError,
} from "@shared";

type DownloadErrorResult = { ok: false; error?: string };
const KNOWN_DOWNLOAD_ERRORS = new Set<string>(Object.values(DownloadError));

const HYDRA_UNLOCK_DOWNLOADERS = new Set<Downloader>([
  Downloader.Datanodes,
  Downloader.VikingFile,
]);

const handleHydraUnlockError = (
  err: AxiosError,
  downloader: Downloader
): DownloadErrorResult | null => {
  if (!HYDRA_UNLOCK_DOWNLOADERS.has(downloader)) return null;

  const status = err.response?.status;
  const data = err.response?.data;
  const message =
    typeof data === "string"
      ? data
      : (data as { message?: unknown } | undefined)?.message;

  if (status === 429 && downloader === Downloader.VikingFile) {
    return { ok: false, error: DownloadError.VikingFileQuotaExceeded };
  }

  if (
    status === 400 &&
    downloader === Downloader.VikingFile &&
    typeof message === "string"
  ) {
    return { ok: false, error: DownloadError.VikingFileSubscriptionRequired };
  }

  if (status === 401) {
    return { ok: false, error: DownloadError.HosterUnlockLoginRequired };
  }

  if (status === 404) {
    return { ok: false, error: DownloadError.HosterUnlockFileNotFound };
  }

  if (status === 502) {
    return { ok: false, error: DownloadError.HosterUnlockUnavailable };
  }

  return null;
};

const handleAxiosError = (
  err: AxiosError,
  downloader: Downloader
): DownloadErrorResult | null => {
  const rpcErrorCode = (err.response?.data as { error?: string } | undefined)
    ?.error;

  if (downloader === Downloader.Torrent) {
    if (rpcErrorCode === "invalid_magnet") {
      return { ok: false, error: DownloadError.InvalidMagnet };
    }

    if (rpcErrorCode === "metadata_timeout") {
      return { ok: false, error: DownloadError.TorrentMetadataTimeout };
    }

    if (rpcErrorCode === "metadata_incomplete") {
      return { ok: false, error: DownloadError.TorrentMetadataIncomplete };
    }

    if (rpcErrorCode === "empty_selection") {
      return { ok: false, error: DownloadError.TorrentNoFilesSelected };
    }

    if (rpcErrorCode === "invalid_file_indices") {
      return { ok: false, error: DownloadError.TorrentInvalidFileSelection };
    }

    if (rpcErrorCode === "too_many_files") {
      return { ok: false, error: DownloadError.TorrentTooManyFiles };
    }

    if (rpcErrorCode === "invalid_trackers") {
      return { ok: false, error: DownloadError.TorrentInvalidTrackers };
    }

    if (rpcErrorCode) {
      return { ok: false, error: DownloadError.TorrentFilesUnavailable };
    }
  }

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

  const hydraUnlockResult = handleHydraUnlockError(err, downloader);
  if (hydraUnlockResult) return hydraUnlockResult;

  if (downloader === Downloader.TorBox) {
    const status = err.response?.status;

    if (status === 401 || status === 403) {
      return { ok: false, error: DownloadError.TorBoxAccountNotAuthorized };
    }

    if (status === 429) {
      return { ok: false, error: DownloadError.TorBoxRateLimitExceeded };
    }

    if (status === 503) {
      return { ok: false, error: DownloadError.TorBoxUnavailable };
    }

    const detail = (err.response?.data as { detail?: unknown } | undefined)
      ?.detail;

    if (typeof detail === "string" && detail.length > 0) {
      return { ok: false, error: detail };
    }
  }

  return null;
};

const NETWORK_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const TLS_ERROR_CODE_PREFIXES = [
  "CERT_",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_",
  "SELF_SIGNED_CERT",
  "UNABLE_TO_",
];

const MAX_CAUSE_DEPTH = 5;

const stringifyUnknownError = (err: unknown): string => {
  if (typeof err === "string") return err;
  if (typeof err === "number" || typeof err === "boolean") return `${err}`;
  if (err === null) return "null";
  if (err === undefined) return "undefined";

  try {
    return JSON.stringify(err) ?? "unknown error";
  } catch {
    return "unknown error";
  }
};

export const describeErrorCause = (err: unknown): string => {
  const parts: string[] = [];

  let current = err;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) break;

    const code = (current as Error & { code?: unknown }).code;
    parts.push(
      typeof code === "string"
        ? `${current.name}(${code}): ${current.message}`
        : `${current.name}: ${current.message}`
    );

    current = current.cause;
  }

  return parts.join(" <- ") || stringifyUnknownError(err);
};

const findErrorCode = (err: unknown): string | null => {
  let current = err;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) return null;

    const code = (current as Error & { code?: unknown }).code;
    if (typeof code === "string") return code;

    current = current.cause;
  }

  return null;
};

const handleNetworkError = (err: unknown): DownloadErrorResult | null => {
  const code = findErrorCode(err);
  if (!code) return null;

  if (TLS_ERROR_CODE_PREFIXES.some((prefix) => code.startsWith(prefix))) {
    return { ok: false, error: DownloadError.NetworkCertificateRejected };
  }

  if (NETWORK_ERROR_CODES.has(code)) {
    return { ok: false, error: DownloadError.NetworkUnreachable };
  }

  return null;
};

const HOST_NAMES: Partial<Record<Downloader, string>> = {
  [Downloader.FuckingFast]: "FuckingFast",
};

// Gofile reports a deleted, expired or emptied link through several different
// internal messages, none of which are meant to reach the user.
const GOFILE_FILE_GONE_PATTERNS = [
  "content not found",
  "has expired",
  "no file links found",
  "failed to validate download url: 404",
  "failed to validate download url: 410",
];

const handleHostSpecificError = (
  message: string,
  downloader: Downloader
): DownloadErrorResult | null => {
  if (
    downloader === Downloader.Gofile &&
    (message.includes("RATE_LIMIT:") || message.includes("error-rateLimit"))
  ) {
    return { ok: false, error: DownloadError.GofileQuotaExceeded };
  }

  if (downloader === Downloader.Gofile) {
    const normalizedMessage = message.toLowerCase();

    if (
      GOFILE_FILE_GONE_PATTERNS.some((pattern) =>
        normalizedMessage.includes(pattern)
      )
    ) {
      return { ok: false, error: DownloadError.HosterUnlockFileNotFound };
    }
  }

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

const mapTorrentErrorCode = (code: string): DownloadErrorResult | null => {
  if (code === "invalid_magnet") {
    return { ok: false, error: DownloadError.InvalidMagnet };
  }

  if (code === "metadata_timeout") {
    return { ok: false, error: DownloadError.TorrentMetadataTimeout };
  }

  if (code === "metadata_incomplete") {
    return { ok: false, error: DownloadError.TorrentMetadataIncomplete };
  }

  if (code === "empty_selection") {
    return { ok: false, error: DownloadError.TorrentNoFilesSelected };
  }

  if (code === "invalid_file_indices") {
    return { ok: false, error: DownloadError.TorrentInvalidFileSelection };
  }

  if (code === "too_many_files") {
    return { ok: false, error: DownloadError.TorrentTooManyFiles };
  }

  if (code === "invalid_trackers") {
    return { ok: false, error: DownloadError.TorrentInvalidTrackers };
  }

  return null;
};

const handleThrownError = (
  err: Error,
  downloader: Downloader
): DownloadErrorResult => {
  if (downloader === Downloader.Torrent) {
    const mapped = mapTorrentErrorCode(err.message);
    if (mapped) return mapped;
  }

  return (
    handleHostSpecificError(err.message, downloader) ??
    handleNetworkError(err) ?? { ok: false, error: err.message }
  );
};

export const handleDownloadError = (
  err: unknown,
  downloader: Downloader
): DownloadErrorResult => {
  if (err instanceof AxiosError) {
    const result = handleAxiosError(err, downloader);
    if (result) return result;
  }

  if (
    err instanceof SubscriptionRequiredError &&
    downloader === Downloader.VikingFile
  ) {
    return { ok: false, error: DownloadError.VikingFileSubscriptionRequired };
  }

  if (
    err instanceof UserNotLoggedInError &&
    HYDRA_UNLOCK_DOWNLOADERS.has(downloader)
  ) {
    return { ok: false, error: DownloadError.HosterUnlockLoginRequired };
  }

  if (err instanceof Error) return handleThrownError(err, downloader);

  return { ok: false };
};

export const isKnownDownloadError = (err: unknown) => {
  return err instanceof Error && KNOWN_DOWNLOAD_ERRORS.has(err.message);
};
