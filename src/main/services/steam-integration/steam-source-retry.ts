import { isAxiosError } from "axios";

export const STEAM_SOURCE_429_MAX_ATTEMPTS = 5;
export const STEAM_SOURCE_502_MAX_ATTEMPTS = 3;
const STEAM_SOURCE_429_DELAY_CAP_MS = 30_000;

export const getSteamSourceHttpStatus = (error: unknown): number | null => {
  if (!isAxiosError(error)) return null;
  return error.response?.status ?? null;
};

export const getSteamSourceRetryAfterMs = (error: unknown): number | null => {
  if (!isAxiosError(error)) return null;

  const header = error.response?.headers?.["retry-after"];
  if (header == null) return null;

  const seconds = Number.parseInt(String(header), 10);
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  return seconds * 1000;
};

export const getSteamSourceRetryDelayMs = (
  error: unknown,
  failedAttempt: number
): number => {
  const status = getSteamSourceHttpStatus(error);
  const exponent = Math.max(0, failedAttempt - 1);

  if (status === 429) {
    return (
      getSteamSourceRetryAfterMs(error) ??
      Math.min(STEAM_SOURCE_429_DELAY_CAP_MS, 1000 * 2 ** exponent)
    );
  }

  if (status === 502) {
    return 500 * 2 ** exponent;
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

export const isSteamSourceAchievementSkippable = (error: unknown) => {
  const status = getSteamSourceHttpStatus(error);
  return status === 403 || status === 409 || status === 429 || status === 502;
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
