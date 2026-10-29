import { isAxiosError } from "axios";

import {
  GAME_NOT_FOUND_ERROR_CODE,
  getGroupedSouvenirErrorCode,
  isGroupedSouvenirNetworkFailure,
  isMissingGroupedSouvenirScreenshot,
  isRejectedGroupedSouvenirRequest,
} from "../achievements/grouped-souvenir-retry-policy.js";

export type ScreenshotUploadRecoveryAction =
  | "already_uploaded"
  | "wait"
  | "rate_limit_wait"
  | "moderation_wait"
  | "retry"
  | "wait_for_game"
  | "recompress_standard"
  | "rotate_client_id"
  | "terminal"
  | "stop";

export interface ScreenshotUploadFailure {
  code: string;
  action: ScreenshotUploadRecoveryAction;
  retryAfterMs?: number;
}

export const SCREENSHOT_UPLOAD_MAX_ATTEMPTS = 6;
export const SCREENSHOT_UPLOAD_MAX_GAME_WAITS = 30;
export const SCREENSHOT_UPLOAD_MAX_SERVER_WAITS = 30;
export const SCREENSHOT_UPLOAD_RETRY_BASE_DELAY_MS = 5_000;
export const SCREENSHOT_UPLOAD_RETRY_MAX_DELAY_MS = 10 * 60_000;
export const SCREENSHOT_UPLOAD_GAME_WAIT_DELAY_MS = 30_000;
export const SCREENSHOT_UPLOAD_CAPACITY_WAIT_DELAY_MS = 60_000;
export const SCREENSHOT_MODERATION_DEFAULT_WAIT_MS = 30_000;
export const SCREENSHOT_MODERATION_BACKOFF_BASE_MS = 2_000;
export const SCREENSHOT_MODERATION_BACKOFF_MAX_MS = 60_000;

export const SCREENSHOT_MISSING_FILE_CODE = "screenshot_missing";
export const SCREENSHOT_ALREADY_UPLOADED_CODE = "screenshots/already-uploaded";
export const SCREENSHOT_FEATURE_DISABLED_CODE = "feature/feature-not-enabled";

const RECOVERY_BY_ERROR_CODE: Record<string, ScreenshotUploadRecoveryAction> = {
  [GAME_NOT_FOUND_ERROR_CODE]: "wait_for_game",
  [SCREENSHOT_ALREADY_UPLOADED_CODE]: "already_uploaded",
  "screenshots/exceeds-tier-limit": "recompress_standard",
  "screenshots/cloud-subscription-required": "recompress_standard",
  "screenshots/client-id-conflict": "rotate_client_id",
  "screenshots/upload-expired": "rotate_client_id",
  "screenshots/not-found": "rotate_client_id",
  "screenshots/upload-incomplete": "rotate_client_id",
  "screenshots/upload-mismatch": "rotate_client_id",
  "screenshots/upload-rate-limited": "rate_limit_wait",
  "screenshots/upload-capacity-reached": "wait",
  "screenshots/text-change-rate-limit-unavailable": "wait",
  "screenshots/moderation-unavailable": "moderation_wait",
  "screenshots/moderation-in-progress": "moderation_wait",
  "screenshots/moderation-rate-limited": "moderation_wait",
  "screenshots/limit-reached": "terminal",
  "screenshots/blocked-limit-reached": "terminal",
  screenshot_too_large: "terminal",
  screenshot_unreadable: "terminal",
  [SCREENSHOT_FEATURE_DISABLED_CODE]: "terminal",
  "user not logged in": "stop",
};

const getRetryAfterMs = (error: unknown) => {
  if (!isAxiosError(error)) return null;
  const headers = error.response?.headers as
    | Record<string, unknown>
    | undefined;
  const value = Number(headers?.["retry-after"]);
  return Number.isFinite(value) && value >= 0 ? value * 1_000 : null;
};

const getSystemErrorCode = (error: unknown) => {
  if (!(error instanceof Error) || isAxiosError(error)) return null;
  const { code } = error as NodeJS.ErrnoException;
  return typeof code === "string" && code ? code : null;
};

export const getScreenshotModerationWaitDelay = (
  failure: ScreenshotUploadFailure,
  moderationWaits: number
) =>
  (failure.retryAfterMs ?? SCREENSHOT_MODERATION_DEFAULT_WAIT_MS) +
  Math.min(
    SCREENSHOT_MODERATION_BACKOFF_BASE_MS * 2 ** moderationWaits,
    SCREENSHOT_MODERATION_BACKOFF_MAX_MS
  );

const getRecoveryAction = (
  code: string,
  error: unknown
): ScreenshotUploadRecoveryAction => {
  const mapped = RECOVERY_BY_ERROR_CODE[code];
  if (mapped) return mapped;
  if (isGroupedSouvenirNetworkFailure(error)) return "retry";
  if (isRejectedGroupedSouvenirRequest(error)) return "terminal";
  return "retry";
};

const HONORS_RETRY_AFTER = new Set<ScreenshotUploadRecoveryAction>([
  "moderation_wait",
  "rate_limit_wait",
  "retry",
]);

export const getScreenshotUploadFailure = (
  error: unknown
): ScreenshotUploadFailure => {
  if (isMissingGroupedSouvenirScreenshot(error)) {
    return { code: SCREENSHOT_MISSING_FILE_CODE, action: "terminal" };
  }

  const code = getSystemErrorCode(error) ?? getGroupedSouvenirErrorCode(error);
  const action = getRecoveryAction(code, error);
  const retryAfterMs = HONORS_RETRY_AFTER.has(action)
    ? getRetryAfterMs(error)
    : null;
  return retryAfterMs === null
    ? { code, action }
    : { code, action, retryAfterMs };
};

export const getAlreadyUploadedScreenshot = (error: unknown) => {
  if (!isAxiosError(error)) return null;
  const data = error.response?.data as Record<string, unknown> | undefined;
  if (typeof data?.id !== "string" || !data.id) return null;

  return {
    id: data.id,
    moderationStatus: data.moderationStatus,
    moderationReason: data.moderationReason,
  };
};

export const getScreenshotUploadRetryDelay = (attempt: number) =>
  Math.min(
    SCREENSHOT_UPLOAD_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
    SCREENSHOT_UPLOAD_RETRY_MAX_DELAY_MS
  );

export interface ScreenshotUploadRetryState {
  uploadAttempts: number;
  gameWaits: number;
  moderationWaits?: number;
  capacityWaits?: number;
  rateLimitWaits?: number;
}

export type ScreenshotUploadNextStep =
  | { kind: "retry_at"; delay: number; countsAsAttempt: boolean }
  | { kind: "retry_now"; quality?: "STANDARD"; rotateClientId?: boolean }
  | { kind: "failed" }
  | { kind: "stopped" };

export const planScreenshotUploadRecovery = (
  failure: ScreenshotUploadFailure,
  state: ScreenshotUploadRetryState,
  currentQuality: "STANDARD" | "CLOUD"
): ScreenshotUploadNextStep => {
  switch (failure.action) {
    case "already_uploaded":
      return state.uploadAttempts >= SCREENSHOT_UPLOAD_MAX_ATTEMPTS
        ? { kind: "failed" }
        : { kind: "retry_now" };
    case "stop":
      return { kind: "stopped" };
    case "terminal":
      return { kind: "failed" };
    case "wait_for_game":
      return state.gameWaits >= SCREENSHOT_UPLOAD_MAX_GAME_WAITS
        ? { kind: "failed" }
        : {
            kind: "retry_at",
            delay: SCREENSHOT_UPLOAD_GAME_WAIT_DELAY_MS,
            countsAsAttempt: false,
          };
    case "recompress_standard":
      return currentQuality === "CLOUD"
        ? { kind: "retry_now", quality: "STANDARD" }
        : { kind: "failed" };
    case "rotate_client_id":
      return state.uploadAttempts >= SCREENSHOT_UPLOAD_MAX_ATTEMPTS
        ? { kind: "failed" }
        : { kind: "retry_now", rotateClientId: true };
    case "wait":
      return (state.capacityWaits ?? 0) >= SCREENSHOT_UPLOAD_MAX_SERVER_WAITS
        ? { kind: "failed" }
        : {
            kind: "retry_at",
            delay: SCREENSHOT_UPLOAD_CAPACITY_WAIT_DELAY_MS,
            countsAsAttempt: false,
          };
    case "rate_limit_wait":
      return (state.rateLimitWaits ?? 0) >= SCREENSHOT_UPLOAD_MAX_SERVER_WAITS
        ? { kind: "failed" }
        : {
            kind: "retry_at",
            delay: Math.min(
              failure.retryAfterMs ??
                getScreenshotUploadRetryDelay((state.rateLimitWaits ?? 0) + 1),
              SCREENSHOT_UPLOAD_RETRY_MAX_DELAY_MS
            ),
            countsAsAttempt: false,
          };
    case "moderation_wait":
      return (state.moderationWaits ?? 0) >= SCREENSHOT_UPLOAD_MAX_SERVER_WAITS
        ? { kind: "failed" }
        : {
            kind: "retry_at",
            delay: getScreenshotModerationWaitDelay(
              failure,
              state.moderationWaits ?? 0
            ),
            countsAsAttempt: false,
          };
    case "retry":
      return state.uploadAttempts >= SCREENSHOT_UPLOAD_MAX_ATTEMPTS
        ? { kind: "failed" }
        : {
            kind: "retry_at",
            delay: Math.min(
              failure.retryAfterMs ??
                getScreenshotUploadRetryDelay(state.uploadAttempts),
              SCREENSHOT_UPLOAD_RETRY_MAX_DELAY_MS
            ),
            countsAsAttempt: true,
          };
  }
};
