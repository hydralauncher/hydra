import { isAxiosError } from "axios";

export const STEAM_SOURCE_502_MAX_ATTEMPTS = 3;
export const STEAM_SOURCE_502_BASE_DELAY_MS = 500;
export const STEAM_SOURCE_502_DELAY_MULTIPLIER = 2;

export const STEAM_SOURCE_429_MAX_ATTEMPTS = 5;
export const STEAM_SOURCE_429_BASE_DELAY_MS = 1000;
export const STEAM_SOURCE_429_DELAY_MULTIPLIER = 2;
export const STEAM_SOURCE_429_MAX_DELAY_MS = 30_000;

export const parseNumericRetryAfterSeconds = (
  value: unknown
): number | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.trunc(raw);
  }

  if (typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  return Number.parseInt(trimmed, 10);
};

const readSteamWebApiHttpStatus = (error: unknown): number | null => {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "SteamWebApiHttpError" &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return null;
};

export const getSteamSourceHttpStatus = (error: unknown): number | null => {
  const steamStatus = readSteamWebApiHttpStatus(error);
  if (steamStatus != null) return steamStatus;

  if (!isAxiosError(error)) return null;
  return error.response?.status ?? null;
};

const readRetryAfterSeconds = (error: unknown): number | null => {
  if (
    typeof error === "object" &&
    error !== null &&
    "retryAfterSeconds" in error
  ) {
    const retryAfterSeconds = parseNumericRetryAfterSeconds(
      (error as { retryAfterSeconds: unknown }).retryAfterSeconds
    );
    if (retryAfterSeconds != null) return retryAfterSeconds;
  }

  if (!isAxiosError(error)) return null;

  return parseNumericRetryAfterSeconds(
    error.response?.headers?.["retry-after"]
  );
};

export const getSteamSourceRetryDelayMs = (
  error: unknown,
  failedAttempt: number
): number => {
  const status = getSteamSourceHttpStatus(error);
  const exponent = Math.max(0, failedAttempt - 1);

  if (status === 429) {
    const retryAfterSeconds = readRetryAfterSeconds(error);
    if (retryAfterSeconds != null) {
      return retryAfterSeconds * 1000;
    }

    return Math.min(
      STEAM_SOURCE_429_BASE_DELAY_MS *
        STEAM_SOURCE_429_DELAY_MULTIPLIER ** exponent,
      STEAM_SOURCE_429_MAX_DELAY_MS
    );
  }

  if (status === 502) {
    return (
      STEAM_SOURCE_502_BASE_DELAY_MS *
      STEAM_SOURCE_502_DELAY_MULTIPLIER ** exponent
    );
  }

  return 0;
};

export const shouldRetrySteamSource = (
  error: unknown,
  failedAttempt: number
): boolean => {
  const status = getSteamSourceHttpStatus(error);

  if (status === 429) {
    return failedAttempt < STEAM_SOURCE_429_MAX_ATTEMPTS;
  }

  if (status === 502) {
    return failedAttempt < STEAM_SOURCE_502_MAX_ATTEMPTS;
  }

  return false;
};

export const isSteamSyncConflict = (error: unknown) =>
  getSteamSourceHttpStatus(error) === 409;

const readErrorMessage = (value: unknown): string | null => {
  if (typeof value === "string") return value;

  if (typeof value === "object" && value !== null && "message" in value) {
    const message = (value as { message: unknown }).message;
    if (typeof message === "string") return message;
  }

  return null;
};

export const isSteamPrivateProfilePayload = (payload: unknown): boolean => {
  const message = readErrorMessage(payload);
  if (!message) return false;

  return (
    message === "steam-profile-private" ||
    message.includes("profile/steam-profile-private")
  );
};

export const isSteamSourceLibraryFatal = (error: unknown) => {
  if (getSteamSourceHttpStatus(error) === 403) return true;
  if (isSteamPrivateProfilePayload(error)) return true;

  if (isAxiosError(error)) {
    return isSteamPrivateProfilePayload(error.response?.data);
  }

  return false;
};

const STEAM_SOURCE_TRANSPORT_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "ERR_NETWORK",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

const readErrorCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }

  return typeof error.code === "string" ? error.code : null;
};

export const isSteamSourceTransportError = (error: unknown): boolean => {
  const directCode = readErrorCode(error);
  if (directCode && STEAM_SOURCE_TRANSPORT_ERROR_CODES.has(directCode)) {
    return true;
  }

  if (typeof error !== "object" || error === null || !("cause" in error)) {
    return false;
  }

  const causeCode = readErrorCode(error.cause);
  return Boolean(
    causeCode && STEAM_SOURCE_TRANSPORT_ERROR_CODES.has(causeCode)
  );
};

export const isSteamSourceAchievementSkippable = (error: unknown) => {
  const status = getSteamSourceHttpStatus(error);
  return (
    status === 400 ||
    status === 403 ||
    status === 409 ||
    status === 429 ||
    status === 502 ||
    isSteamSourceTransportError(error)
  );
};

export const isSteamRateLimitedPayload = (payload: unknown): boolean => {
  const message = readErrorMessage(payload);
  if (!message) return false;

  return (
    message === "steam-rate-limited" ||
    message.includes("profile/steam-rate-limited")
  );
};

export const isSteamSourceRateLimited = (error: unknown) => {
  if (getSteamSourceHttpStatus(error) === 429) return true;
  if (isSteamRateLimitedPayload(error)) return true;

  if (isAxiosError(error)) {
    return isSteamRateLimitedPayload(error.response?.data);
  }

  return false;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    const error = new Error("steam-sync-aborted");
    error.name = "AbortError";
    throw error;
  }
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error("steam-sync-aborted");
      error.name = "AbortError";
      reject(error);
      return;
    }

    const timeout = setTimeout(resolve, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      const error = new Error("steam-sync-aborted");
      error.name = "AbortError";
      reject(error);
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });

export const withSteamSourceRetry = async <T>(
  fn: () => Promise<T>,
  options?: {
    signal?: AbortSignal;
    onRetry?: (
      status: number | null,
      delayMs: number,
      failedAttempt: number
    ) => void;
  }
): Promise<T> => {
  let failedAttempt = 0;

  for (;;) {
    throwIfAborted(options?.signal);

    try {
      return await fn();
    } catch (error) {
      failedAttempt += 1;

      if (!shouldRetrySteamSource(error, failedAttempt)) {
        throw error;
      }

      const delayMs = getSteamSourceRetryDelayMs(error, failedAttempt);
      options?.onRetry?.(
        getSteamSourceHttpStatus(error),
        delayMs,
        failedAttempt
      );

      await sleep(delayMs, options?.signal);
    }
  }
};
