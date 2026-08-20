import { isAxiosError } from "axios";

const TERMINAL_HTTP_STATUSES = new Set([400, 404, 409, 422]);
const TERMINAL_SOUVENIR_CONFLICT_CODES = new Set([
  "achievements/souvenir-conflict",
  "achievements/souvenir-upload-deleted",
  "achievements/souvenir-upload-length-mismatch",
]);

export const isMissingGroupedSouvenirScreenshot = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  (error as NodeJS.ErrnoException).code === "ENOENT";

const getResponseData = (error: unknown): Record<string, unknown> | null => {
  if (!isAxiosError(error) || !error.response?.data) return null;
  if (typeof error.response.data !== "object") return null;
  return error.response.data as Record<string, unknown>;
};

export const getGroupedSouvenirErrorCode = (error: unknown) => {
  if (isMissingGroupedSouvenirScreenshot(error)) {
    return "souvenir_screenshot_missing";
  }

  const data = getResponseData(error);
  const code = data?.errorCode ?? data?.code ?? data?.message;

  if (typeof code === "string") return code;
  if (isAxiosError(error) && error.response?.status) {
    return `http_${error.response.status}`;
  }
  if (error instanceof Error) return error.message;
  return "unknown_error";
};

export const isTerminalGroupedSouvenirError = (
  error: unknown,
  clientId: string
) => {
  if (!isAxiosError(error) || !error.response?.status) return false;
  if (!TERMINAL_HTTP_STATUSES.has(error.response.status)) return false;

  const responseData = getResponseData(error);
  const responseCode =
    responseData?.errorCode ?? responseData?.code ?? responseData?.message;
  if (
    error.response.status === 409 &&
    typeof responseCode === "string" &&
    TERMINAL_SOUVENIR_CONFLICT_CODES.has(responseCode)
  ) {
    return true;
  }

  const responseClientId = responseData?.clientId;
  return responseClientId === clientId;
};
