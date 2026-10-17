const SAFE_ERROR_NAMES = new Set([
  "Error",
  "AxiosError",
  "AbortError",
  "TypeError",
  "RangeError",
  "UserNotLoggedInError",
  "SubscriptionRequiredError",
  "EpicIntegrationError",
]);

const SAFE_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTFOUND",
  "EPIPE",
  "EPROTO",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ERR_CANCELED",
  "ERR_BAD_REQUEST",
  "ERR_BAD_RESPONSE",
  "ERR_NETWORK",
  "ERR_FR_TOO_MANY_REDIRECTS",
  "ERR_INVALID_URL",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

interface NetworkErrorSummary {
  name: string;
  code?: string;
  status?: number;
}

/** HTTP and socket errors can contain credentials in their config, stack, URL,
 * response and message. Keep only known diagnostic codes and numeric status.
 */
export function summarizeNetworkError(error: unknown): NetworkErrorSummary {
  const summary: NetworkErrorSummary = { name: "UnknownError" };
  if (error === null || typeof error !== "object") return summary;
  try {
    const value = error as Record<string, unknown>;
    summary.name =
      typeof value.name === "string" && SAFE_ERROR_NAMES.has(value.name)
        ? value.name
        : "Error";
    if (typeof value.code === "string" && SAFE_ERROR_CODES.has(value.code)) {
      summary.code = value.code;
    }
    const response = value.response;
    const status =
      response !== null && typeof response === "object"
        ? (response as Record<string, unknown>).status
        : undefined;
    if (
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
    ) {
      summary.status = status;
    }
    return summary;
  } catch {
    return { name: "UnknownError" };
  }
}
