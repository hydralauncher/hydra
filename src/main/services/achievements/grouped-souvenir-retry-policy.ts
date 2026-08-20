import { isAxiosError } from "axios";

const TERMINAL_HTTP_STATUSES = new Set([400, 404, 409, 422]);
const SOUVENIR_CONFLICT_CODE = "achievements/souvenir-conflict";

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
    responseCode === SOUVENIR_CONFLICT_CODE
  ) {
    return true;
  }

  const responseClientId = responseData?.clientId;
  return responseClientId === clientId;
};
