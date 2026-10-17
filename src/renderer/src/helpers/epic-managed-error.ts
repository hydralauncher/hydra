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

const COMPATIBILITY_ERRORS = {
  "compatibility-runtime-unavailable": "epic_compatibility_runtime_unavailable",
  "compatibility-runtime-download-failed":
    "epic_compatibility_runtime_download_failed",
  "compatibility-prefix-invalid": "epic_compatibility_prefix_invalid",
  "compatibility-prefix-busy": "epic_compatibility_prefix_busy",
  "compatibility-launch-failed": "epic_compatibility_launch_failed",
} as const;

export const getEpicManagedError = (error: EpicSaveError | undefined) => {
  if (error && Object.hasOwn(COMPATIBILITY_ERRORS, error))
    return {
      key: COMPATIBILITY_ERRORS[error as keyof typeof COMPATIBILITY_ERRORS],
      ns: "game_details",
    };
  if (error === "unsupported-platform" || error === "unsupported-architecture")
    return { key: "epic_install_platform_unsupported", ns: "game_details" };
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
  if (error === "external-launcher-required")
    return { key: "epic_external_launcher_required", ns: "game_details" };
  if (error === "saves-unsupported" || error === "not-installable") {
    return { key: "epic_save_status_unavailable", ns: "game_details" };
  }
  return { key: "epic_managed_error_generic", ns: "game_details" };
};

const LAUNCH_ERROR_CODES = new Set<string>([
  ...CONNECTION_ERRORS,
  ...Object.keys(COMPATIBILITY_ERRORS),
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
  "external-launcher-required",
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
