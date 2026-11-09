import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEpicSyncRun } from "./sync-protocol.js";
import {
  EPIC_SYNC_RUN_ID_MIN_LENGTH,
  EPIC_SYNC_RUN_ID_MAX_LENGTH,
} from "./constants.js";

const run = (id: unknown) => ({
  id,
  trigger: "MANUAL",
  status: "PENDING",
  gamesCount: 0,
  error: null,
  startedAt: null,
  completedAt: null,
  createdAt: "2026-10-13T00:00:00Z",
});
test("public Epic execution IDs stay opaque and case-sensitive Hashid strings", () => {
  for (const length of [
    EPIC_SYNC_RUN_ID_MIN_LENGTH,
    EPIC_SYNC_RUN_ID_MAX_LENGTH,
  ]) {
    const id = "Ab0".repeat(length).slice(0, length);
    assert.equal(parseEpicSyncRun(run(id)).id, id);
  }
});
test("new Epic protocol rejects UUIDs, internal integers and malformed public IDs", () => {
  for (const id of [
    42,
    "42",
    "00000000-0000-4000-8000-000000000001",
    null,
    "",
    "invalid!",
    "x".repeat(EPIC_SYNC_RUN_ID_MAX_LENGTH + 1),
  ]) {
    assert.throws(() => parseEpicSyncRun(run(id)), {
      code: "invalid-response",
    });
  }
});
