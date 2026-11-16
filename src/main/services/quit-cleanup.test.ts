import assert from "node:assert/strict";
import { test } from "node:test";
import { settleWithin } from "./quit-cleanup.ts";

const QUIT_STEP_TIMEOUT_MS = 1_000;
const STALLED_STEP_TIMEOUT_MS = 50;
// Generous bound so a slow CI machine cannot mistake the deadline for a hang.
const STALLED_STEP_ELAPSED_LIMIT_MS = 1_000;

test("a quit step that finishes reports settled", async () => {
  let finished = false;

  const outcome = await settleWithin(async () => {
    finished = true;
  }, QUIT_STEP_TIMEOUT_MS);

  assert.equal(outcome, "settled");
  assert.equal(finished, true);
});

test("a failing quit step propagates its error", async () => {
  await assert.rejects(
    settleWithin(async () => {
      throw new Error("torrent_shutdown");
    }, QUIT_STEP_TIMEOUT_MS),
    /torrent_shutdown/
  );
});

test("a quit step that never settles times out", async () => {
  const startedAt = Date.now();

  const outcome = await settleWithin(
    () => new Promise<void>(() => {}),
    STALLED_STEP_TIMEOUT_MS
  );

  assert.equal(outcome, "timed-out");
  assert.ok(Date.now() - startedAt < STALLED_STEP_ELAPSED_LIMIT_MS);
});
