import type { EpicSyncRun } from "../../../types/epic-integration.types";
import type { EpicAchievementSummary } from "../../../types/epic-integration.types";
import { EpicIntegrationError, isRecord } from "./auth-protocol.js";
import {
  EPIC_SYNC_RUN_ID_MIN_LENGTH,
  EPIC_SYNC_RUN_ID_MAX_LENGTH,
} from "./constants.js";
export const EPIC_RUN_ID_PATTERN = new RegExp(
  `^[a-zA-Z0-9]{${EPIC_SYNC_RUN_ID_MIN_LENGTH},${EPIC_SYNC_RUN_ID_MAX_LENGTH}}$`
);
// Read-only compatibility with private metadata from the unpublished UUID implementation.
export const EPIC_LEGACY_RUN_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseEpicSyncRun(value: unknown): EpicSyncRun {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !EPIC_RUN_ID_PATTERN.test(value.id) ||
    !["FIRST_LINK", "STARTUP", "MANUAL"].includes(value.trigger as string) ||
    !["PENDING", "RUNNING", "SUCCEEDED", "FAILED"].includes(
      value.status as string
    ) ||
    !Number.isInteger(value.gamesCount) ||
    (value.gamesCount as number) < 0 ||
    (value.error !== null && typeof value.error !== "string") ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    [value.startedAt, value.completedAt].some(
      (date) =>
        date !== null &&
        (typeof date !== "string" || !Number.isFinite(Date.parse(date)))
    )
  )
    throw new EpicIntegrationError("invalid-response");
  return {
    id: value.id,
    trigger: value.trigger as EpicSyncRun["trigger"],
    status: value.status as EpicSyncRun["status"],
    gamesCount: value.gamesCount as number,
    error: value.error as string | null,
    startedAt: value.startedAt as string | null,
    completedAt: value.completedAt as string | null,
    createdAt: value.createdAt,
    ...(value.achievementSnapshotVersion === 1
      ? { achievementSnapshotVersion: 1 as const }
      : {}),
    ...(value.achievementSummary != null
      ? {
          achievementSummary: parseEpicAchievementSummary(
            value.achievementSummary
          ),
        }
      : {}),
  };
}
export function parseEpicAchievementSummary(
  value: unknown
): EpicAchievementSummary {
  if (
    !isRecord(value) ||
    !["not-requested", "complete", "partial"].includes(
      value.status as string
    ) ||
    ["gamesApplied", "gamesPending", "gamesUnsupported", "unlocksApplied"].some(
      (key) => !Number.isInteger(value[key]) || (value[key] as number) < 0
    )
  )
    throw new EpicIntegrationError("invalid-response");
  return value as unknown as EpicAchievementSummary;
}
export function epicSyncHttpError(error: unknown) {
  if (error instanceof EpicIntegrationError) return error.code;
  if (isRecord(error) && isRecord(error.response)) {
    const status = error.response.status;
    const message = isRecord(error.response.data)
      ? error.response.data.message
      : undefined;
    if (status === 401) return "hydra-auth-required" as const;
    if (
      message === "profile/epic-connection-changed" ||
      message === "profile/epic-not-connected"
    )
      return "stale-connection" as const;
    if (status === 413) return "snapshot-too-large" as const;
    if (status === 409) return "sync-active" as const;
    if (status === 400) return "snapshot-invalid" as const;
    if (status === 404 || status === 502 || status === 503)
      return "api-unavailable" as const;
  }
  if (
    isRecord(error) &&
    (error.code === "ERR_CANCELED" || error.name === "AbortError")
  )
    return "operation-cancelled" as const;
  return "network" as const;
}
