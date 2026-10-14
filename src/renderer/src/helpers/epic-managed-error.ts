import type { EpicCloudSaveState, EpicErrorCode, EpicSaveError } from "@types";
import { getEpicErrorTranslation } from "../pages/settings/settings-epic-state";

const CONNECTION_ERRORS = new Set<EpicErrorCode>([
  "hydra-auth-required",
  "unsupported-platform",
  "unsupported-architecture",
  "legendary-missing",
  "legendary-unavailable",
  "api-unavailable",
  "network",
  "different-account",
  "stale-connection",
  "invalid-response",
  "auth-failed",
  "timeout",
  "session-expired",
  "oauth-client-mismatch",
]);

export const getEpicManagedError = (error: EpicSaveError | undefined) => {
  if (error && CONNECTION_ERRORS.has(error as EpicErrorCode)) {
    return {
      key: getEpicErrorTranslation(error as EpicErrorCode),
      ns: "settings",
    };
  }
  if (error === "save-path-required")
    return { key: "epic_save_path_required", ns: "game_details" };
  if (error === "save-conflict")
    return { key: "epic_save_status_conflict", ns: "game_details" };
  if (error === "prerequisites-required")
    return { key: "epic_prerequisites_required", ns: "game_details" };
  if (error === "update-required")
    return { key: "epic_update_required", ns: "game_details" };
  if (
    error === "saves-unsupported" ||
    error === "not-installable" ||
    error === "unsupported-platform"
  ) {
    return { key: "epic_save_status_unavailable", ns: "game_details" };
  }
  return { key: "epic_managed_error_generic", ns: "game_details" };
};

const LAUNCH_ERROR_CODES = new Set<string>([
  ...CONNECTION_ERRORS,
  "save-path-required",
  "save-conflict",
  "save-sync-failed",
  "save-verification-failed",
  "save-operation-active",
  "saves-unsupported",
  "prerequisites-required",
  "update-required",
  "installation-missing",
  "game-not-owned",
  "invalid-artifact",
  "invalid-path",
  "game-running",
  "not-installable",
  "process-failed",
]);

/** Electron preserves Error messages, but may discard custom error properties. */
export const getEpicLaunchError = (
  error: unknown
): EpicSaveError | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const { code, message } = error as { code?: unknown; message?: unknown };
  const candidate =
    typeof code === "string"
      ? code
      : typeof message === "string"
        ? message.match(/(?:^|:\s*)([a-z][a-z-]+)\s*$/)?.[1]
        : undefined;
  return candidate && LAUNCH_ERROR_CODES.has(candidate)
    ? (candidate as EpicSaveError)
    : undefined;
};

export const canRetryEpicLaunchWithLocalSaves = (
  state: EpicCloudSaveState | null
) =>
  state?.status !== "conflict" &&
  !!state?.error &&
  [
    "network",
    "timeout",
    "save-sync-failed",
    "save-verification-failed",
  ].includes(state.error);
