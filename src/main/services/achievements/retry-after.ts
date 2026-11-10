import { isAxiosError } from "axios";

// Delay the server asked for, in seconds or as an HTTP date; 0 when absent.
export const getRetryAfterMs = (error: unknown) => {
  const retryAfter = isAxiosError(error)
    ? error.response?.headers?.["retry-after"]
    : undefined;
  const seconds =
    typeof retryAfter === "string" || typeof retryAfter === "number"
      ? Number(retryAfter)
      : Number.NaN;
  const date =
    typeof retryAfter === "string" ? Date.parse(retryAfter) : Number.NaN;
  if (Number.isFinite(seconds)) return seconds * 1000;
  if (Number.isFinite(date)) return date - Date.now();
  return 0;
};
