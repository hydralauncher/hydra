import { isValidUmuVersion } from "./umu-release.js";

export interface UmuUpdateState {
  version: string | null;
  checkedAt: number;
  failureCount: number;
  retryAt: number | null;
}

export const UMU_UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const UMU_UPDATE_RETRY_BASE_DELAY_MS = 60 * 60 * 1000;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export const parseUmuUpdateState = (value: unknown): UmuUpdateState | null => {
  if (typeof value !== "object" || value === null) return null;
  const state = value as Record<string, unknown>;
  if (!isFiniteNumber(state.checkedAt)) return null;
  return {
    version: isValidUmuVersion(state.version) ? state.version : null,
    checkedAt: state.checkedAt,
    failureCount:
      isFiniteNumber(state.failureCount) && state.failureCount > 0
        ? Math.floor(state.failureCount)
        : 0,
    retryAt: isFiniteNumber(state.retryAt) ? state.retryAt : null,
  };
};

export const isUmuUpdateCheckDue = (
  state: UmuUpdateState | null,
  now: number
) => {
  if (!state) return true;
  if (state.retryAt !== null) return now >= state.retryAt;
  return now - state.checkedAt >= UMU_UPDATE_CHECK_INTERVAL_MS;
};

export const getUmuUpdateRetryDelay = (failureCount: number) =>
  Math.min(
    UMU_UPDATE_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, failureCount - 1),
    UMU_UPDATE_CHECK_INTERVAL_MS
  );

export const recordUmuUpdateSuccess = (
  version: string | null,
  now: number
): UmuUpdateState => ({
  version,
  checkedAt: now,
  failureCount: 0,
  retryAt: null,
});

export const recordUmuUpdateFailure = (
  state: UmuUpdateState | null,
  installedVersion: string | null,
  now: number
): UmuUpdateState => {
  const failureCount = (state?.failureCount ?? 0) + 1;
  return {
    version: installedVersion,
    checkedAt: state?.checkedAt ?? 0,
    failureCount,
    retryAt: now + getUmuUpdateRetryDelay(failureCount),
  };
};
