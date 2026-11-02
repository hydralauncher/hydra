/** The reasons the API accepts, in the order the report dialog lists them. */
export const CHAT_REPORT_REASONS = [
  "harassment",
  "scam",
  "sexual_content",
  "hate",
  "self_harm",
  "personal_information",
  "other",
] as const;

export type ChatReportReason = (typeof CHAT_REPORT_REASONS)[number];

export const CHAT_REPORT_DESCRIPTION_MAX_LENGTH = 500;

const RATE_LIMITED_ERROR = "chat/rate-limited";

export type ChatReportErrorKind = "failed" | "rate_limited";

export const getReportErrorKind = (error: unknown): ChatReportErrorKind =>
  error instanceof Error && error.message.includes(RATE_LIMITED_ERROR)
    ? "rate_limited"
    : "failed";
