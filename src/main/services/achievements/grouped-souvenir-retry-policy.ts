import { isAxiosError } from "axios";

export type GroupedSouvenirRequestStage = "authorization" | "synchronization";

export type GroupedSouvenirRecoveryAction =
  | "retry"
  | "reauthorize_same_id"
  | "rotate_id_and_reupload"
  | "rebuild"
  | "abandon";

export interface GroupedSouvenirFailure {
  code: string;
  action: GroupedSouvenirRecoveryAction;
}

const TERMINAL_HTTP_STATUSES = new Set([400, 404, 409, 422]);
const SOUVENIR_CONFLICT_CODE = "achievements/souvenir-conflict";
export const SOUVENIR_LIMIT_ERROR_CODE = "achievements/souvenir-limit-reached";

const RECOVERY_BY_REASON: Record<string, GroupedSouvenirRecoveryAction> = {
  reservation_not_found: "reauthorize_same_id",
  reservation_mismatch: "reauthorize_same_id",
  image_key_in_use: "rotate_id_and_reupload",
  achievement_not_found: "rebuild",
  achievement_already_assigned: "abandon",
  souvenir_payload_mismatch: "rotate_id_and_reupload",
  concurrent_update: "retry",
};

const RECOVERY_BY_ERROR_CODE: Record<string, GroupedSouvenirRecoveryAction> = {
  [SOUVENIR_LIMIT_ERROR_CODE]: "abandon",
  "achievements/souvenir-upload-deleted": "rotate_id_and_reupload",
  "achievements/souvenir-upload-expired": "reauthorize_same_id",
  "achievements/souvenir-upload-length-mismatch": "rotate_id_and_reupload",
  "achievements/souvenir-upload-incomplete": "retry",
};

const getConflictReason = (
  data: Record<string, unknown> | null,
  responseCode: string | null
) => {
  if (typeof data?.reason === "string") return data.reason;
  return responseCode && responseCode in RECOVERY_BY_REASON
    ? responseCode
    : null;
};

const getConflictRecoveryAction = (
  reason: string | null,
  stage: GroupedSouvenirRequestStage
): GroupedSouvenirRecoveryAction => {
  if (reason === "reservation_mismatch" && stage === "authorization") {
    return "rotate_id_and_reupload";
  }

  return reason ? (RECOVERY_BY_REASON[reason] ?? "abandon") : "abandon";
};

export const isMissingGroupedSouvenirScreenshot = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  (error as NodeJS.ErrnoException).code === "ENOENT";

const getResponseData = (error: unknown): Record<string, unknown> | null => {
  if (!isAxiosError(error) || !error.response?.data) return null;
  if (typeof error.response.data !== "object") return null;
  return error.response.data as Record<string, unknown>;
};

const getResponseCode = (data: Record<string, unknown> | null) => {
  const code = data?.errorCode ?? data?.code ?? data?.message;
  return typeof code === "string" ? code : null;
};

export const getGroupedSouvenirErrorCode = (error: unknown) => {
  if (isMissingGroupedSouvenirScreenshot(error)) {
    return "souvenir_screenshot_missing";
  }

  const data = getResponseData(error);
  const responseCode = getResponseCode(data);
  const conflictReason = getConflictReason(data, responseCode);
  if (responseCode === SOUVENIR_CONFLICT_CODE && conflictReason) {
    return conflictReason;
  }

  if (responseCode) return responseCode;
  if (isAxiosError(error) && error.response?.status) {
    return `http_${error.response.status}`;
  }
  if (error instanceof Error) return error.message;
  return "unknown_error";
};

export const getGroupedSouvenirFailure = (
  error: unknown,
  clientId: string,
  stage: GroupedSouvenirRequestStage
): GroupedSouvenirFailure => {
  const code = getGroupedSouvenirErrorCode(error);
  if (!isAxiosError(error) || !error.response?.status) {
    return { code, action: "retry" };
  }

  const data = getResponseData(error);
  if (typeof data?.clientId === "string" && data.clientId !== clientId) {
    return { code, action: "retry" };
  }

  const responseCode = getResponseCode(data);
  const reason = getConflictReason(data, responseCode);
  if (responseCode === SOUVENIR_CONFLICT_CODE || reason) {
    return { code, action: getConflictRecoveryAction(reason, stage) };
  }

  if (responseCode && RECOVERY_BY_ERROR_CODE[responseCode]) {
    return { code, action: RECOVERY_BY_ERROR_CODE[responseCode] };
  }

  if (
    TERMINAL_HTTP_STATUSES.has(error.response.status) &&
    data?.clientId === clientId
  ) {
    return { code, action: "abandon" };
  }

  return { code, action: "retry" };
};

export const isTerminalGroupedSouvenirError = (
  error: unknown,
  clientId: string
) =>
  getGroupedSouvenirFailure(error, clientId, "synchronization").action ===
  "abandon";
