import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AxiosError } from "axios";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  getSteamSourceRetryDelayMs,
  isSteamPrivateProfilePayload,
  isSteamRateLimitedPayload,
  isSteamSourceAchievementSkippable,
  isSteamSourceLibraryFatal,
  isSteamSourceRateLimited,
  isSteamSyncConflict,
  shouldRetrySteamSource,
} from "./steam-source-retry.ts";

const axiosError = (status: number, headers: Record<string, string> = {}) => {
  const error = new AxiosError(`Request failed with status code ${status}`);
  error.response = {
    status,
    statusText: "error",
    headers,
    config: { headers: {} },
    data: null,
  } as never;
  return error;
};

describe("Steam source retry policy", () => {
  it("does not retry 429", () => {
    const error = axiosError(429, { "retry-after": "7" });

    assert.equal(shouldRetrySteamSource(error, 1), false);
    assert.equal(getSteamSourceRetryDelayMs(error, 1), 0);
  });

  it("retries 502 three times with short backoff", () => {
    const error = axiosError(502);

    assert.equal(shouldRetrySteamSource(error, 1), true);
    assert.equal(shouldRetrySteamSource(error, 2), true);
    assert.equal(shouldRetrySteamSource(error, 3), false);
    assert.equal(getSteamSourceRetryDelayMs(error, 1), 500);
    assert.equal(getSteamSourceRetryDelayMs(error, 2), 1000);
  });

  it("treats 403 as fatal for the library and skippable for one game", () => {
    const error = axiosError(403);

    assert.equal(shouldRetrySteamSource(error, 1), false);
    assert.equal(isSteamSourceLibraryFatal(error), true);
    assert.equal(isSteamSourceAchievementSkippable(error), true);
  });

  it("treats exhausted 502 as skippable for one game, not fatal for the library", () => {
    const error = axiosError(502);

    assert.equal(isSteamSourceAchievementSkippable(error), true);
    assert.equal(isSteamSourceLibraryFatal(error), false);
  });

  it("treats 429 as skippable for one game, not fatal for the library", () => {
    const error = axiosError(429);

    assert.equal(isSteamSourceAchievementSkippable(error), true);
    assert.equal(isSteamSourceLibraryFatal(error), false);
  });

  it("treats 409 as skippable for one game, not fatal for the library", () => {
    const error = axiosError(409);

    assert.equal(isSteamSourceAchievementSkippable(error), true);
    assert.equal(isSteamSourceLibraryFatal(error), false);
  });

  it("detects 409 sync conflicts", () => {
    assert.equal(isSteamSyncConflict(axiosError(409)), true);
    assert.equal(isSteamSyncConflict(axiosError(404)), false);
  });

  it("treats a private-profile API body as a fatal library error, not an empty library", () => {
    const payload = { message: "profile/steam-profile-private" };

    assert.equal(isSteamPrivateProfilePayload(payload), true);
    assert.equal(isSteamSourceLibraryFatal(payload), true);
    assert.equal(isSteamPrivateProfilePayload({ games: [] }), false);
    assert.equal(isSteamPrivateProfilePayload({}), false);
  });

  it("detects Steam rate-limit payloads and HTTP 429", () => {
    const error = axiosError(429);

    assert.equal(isSteamSourceRateLimited(error), true);
    assert.equal(isSteamRateLimitedPayload({ message: "profile/steam-rate-limited" }), true);
    assert.equal(isSteamRateLimitedPayload({ message: "steam-rate-limited" }), true);
    assert.equal(isSteamRateLimitedPayload({ message: "profile/steam-upstream-unavailable" }), false);
  });
});
