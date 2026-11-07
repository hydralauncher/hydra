import assert from "node:assert/strict";
import { test } from "node:test";
import { runQuitTasks } from "./quit-cleanup.ts";

test("quit cleanup reports failures and waits for every settled task", async () => {
  const finished: string[] = [];

  const result = await runQuitTasks(
    {
      lock: async () => {
        finished.push("lock");
      },
      torrent: async () => {
        throw new Error("torrent_shutdown");
      },
    },
    1_000
  );

  assert.deepEqual(finished, ["lock"]);
  assert.deepEqual(result.pending, []);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].label, "torrent");
});

test("quit cleanup stops waiting for a task that never settles", async () => {
  const startedAt = Date.now();

  const result = await runQuitTasks(
    {
      lock: async () => {},
      torrent: () => new Promise<void>(() => {}),
    },
    50
  );

  assert.ok(Date.now() - startedAt < 1_000);
  assert.deepEqual(result.pending, ["torrent"]);
  assert.deepEqual(result.failed, []);
});
