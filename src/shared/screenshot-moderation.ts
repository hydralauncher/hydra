export const SCREENSHOT_MODERATION_REASON_KEYS = [
  "explicit_imagery",
  "hate_symbols",
  "invalid_image",
  "moderation_failed",
  "personal_information",
  "real_world_gore",
] as const;

export type ScreenshotModerationReasonKey =
  | (typeof SCREENSHOT_MODERATION_REASON_KEYS)[number]
  | "generic";

const KNOWN_REASONS = new Set<string>(SCREENSHOT_MODERATION_REASON_KEYS);

export const getScreenshotModerationReasonKey = (
  reason: string | null | undefined
): ScreenshotModerationReasonKey =>
  reason && KNOWN_REASONS.has(reason)
    ? (reason as ScreenshotModerationReasonKey)
    : "generic";

const NON_RETRYABLE_UPLOAD_ERRORS: Record<string, string> = {
  "screenshots/limit-reached": "error_limit_reached",
  "screenshots/blocked-limit-reached": "error_upload_blocked",
  screenshot_missing: "error_missing_file",
  screenshot_too_large: "error_too_large",
  screenshot_unreadable: "error_unreadable",
};

const RETRYABLE_UPLOAD_ERRORS: Record<string, string> = {
  "feature/feature-not-enabled": "error_feature_disabled",
};

export const getScreenshotUploadErrorKey = (code: string | null | undefined) =>
  (code &&
    (NON_RETRYABLE_UPLOAD_ERRORS[code] ?? RETRYABLE_UPLOAD_ERRORS[code])) ||
  "error_generic";

export const isScreenshotUploadRetryable = (code: string | null | undefined) =>
  !code || !(code in NON_RETRYABLE_UPLOAD_ERRORS);
