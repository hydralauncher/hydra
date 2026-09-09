import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AxiosError } from "axios";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  getSteamSourceRetryDelayMs,
  isSteamPrivateProfilePayload,
  isSteamSourceAchievementSkippable,
  isSteamSourceLibraryFatal,
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
  it("retries 429 up to 5 attempts and uses Retry-After seconds", () => {
    const error = axiosError(429, { "retry-after": "7" });

    assert.equal(shouldRetrySteamSource(error, 1), true);
    assert.equal(shouldRetrySteamSource(error, 4), true);
    assert.equal(shouldRetrySteamSource(error, 5), false);
    assert.equal(getSteamSourceRetryDelayMs(error, 1), 7000);
  });

  it("falls back to exponential delay for 429 without Retry-After", () => {
    const error = axiosError(429);

    assert.equal(getSteamSourceRetryDelayMs(error, 1), 1000);
    assert.equal(getSteamSourceRetryDelayMs(error, 2), 2000);
    assert.equal(getSteamSourceRetryDelayMs(error, 4), 8000);
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
});
