import { isAxiosError } from "axios";

import {
  GAME_NOT_FOUND_ERROR_CODE,
  getGroupedSouvenirErrorCode,
  isGroupedSouvenirNetworkFailure,
  isMissingGroupedSouvenirScreenshot,
  isRejectedGroupedSouvenirRequest,
} from "../achievements/grouped-souvenir-retry-policy";

export type ScreenshotUploadRecoveryAction =
  | "already_uploaded"
  | "wait"
  | "retry"
  | "wait_for_game"
  | "recompress_standard"
  | "rotate_client_id"
  | "pause"
  | "terminal"
  | "stop";

export interface ScreenshotUploadFailure {
  code: string;
  action: ScreenshotUploadRecoveryAction;
}

export const SCREENSHOT_UPLOAD_MAX_ATTEMPTS = 6;
export const SCREENSHOT_UPLOAD_MAX_GAME_WAITS = 30;
export const SCREENSHOT_UPLOAD_RETRY_BASE_DELAY_MS = 5_000;
export const SCREENSHOT_UPLOAD_RETRY_MAX_DELAY_MS = 10 * 60_000;
export const SCREENSHOT_UPLOAD_GAME_WAIT_DELAY_MS = 30_000;
export const SCREENSHOT_UPLOAD_CAPACITY_WAIT_DELAY_MS = 60_000;
export const SCREENSHOT_UPLOAD_PAUSE_DELAY_MS = 30 * 60_000;

export const SCREENSHOT_MISSING_FILE_CODE = "screenshot_missing";
export const SCREENSHOT_ALREADY_UPLOADED_CODE = "screenshots/already-uploaded";
export const SCREENSHOT_FEATURE_DISABLED_CODE = "feature/feature-not-enabled";

const RECOVERY_BY_ERROR_CODE: Record<string, ScreenshotUploadRecoveryAction> = {
  [GAME_NOT_FOUND_ERROR_CODE]: "wait_for_game",
  [SCREENSHOT_ALREADY_UPLOADED_CODE]: "already_uploaded",
  "screenshots/exceeds-tier-limit": "recompress_standard",
  "screenshots/client-id-conflict": "rotate_client_id",
  "screenshots/upload-expired": "rotate_client_id",
  "screenshots/not-found": "rotate_client_id",
  "screenshots/upload-incomplete": "retry",
  "screenshots/upload-mismatch": "retry",
  "screenshots/upload-rate-limited": "retry",
  "screenshots/upload-capacity-reached": "wait",
  "screenshots/disabled-for-game": "terminal",
  "screenshots/limit-reached": "terminal",
  screenshot_too_large: "terminal",
  screenshot_unreadable: "terminal",
  [SCREENSHOT_FEATURE_DISABLED_CODE]: "pause",
  "user not logged in": "stop",
};

export const getScreenshotUploadFailure = (
  error: unknown
): ScreenshotUploadFailure => {
  if (isMissingGroupedSouvenirScreenshot(error)) {
    return { code: SCREENSHOT_MISSING_FILE_CODE, action: "terminal" };
  }

  const code = getGroupedSouvenirErrorCode(error);
  const mapped = RECOVERY_BY_ERROR_CODE[code];
  if (mapped) return { code, action: mapped };

  if (isGroupedSouvenirNetworkFailure(error)) return { code, action: "retry" };
  if (isRejectedGroupedSouvenirRequest(error)) {
    return { code, action: "terminal" };
  }

  return { code, action: "retry" };
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
    case "pause":
      return {
        kind: "retry_at",
        delay: SCREENSHOT_UPLOAD_PAUSE_DELAY_MS,
        countsAsAttempt: false,
      };
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
      return {
        kind: "retry_at",
        delay: SCREENSHOT_UPLOAD_CAPACITY_WAIT_DELAY_MS,
        countsAsAttempt: false,
      };
    case "retry":
      return state.uploadAttempts >= SCREENSHOT_UPLOAD_MAX_ATTEMPTS
        ? { kind: "failed" }
        : {
            kind: "retry_at",
            delay: getScreenshotUploadRetryDelay(state.uploadAttempts),
            countsAsAttempt: true,
          };
  }
};
