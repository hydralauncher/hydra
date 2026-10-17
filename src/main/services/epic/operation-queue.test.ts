import assert from "node:assert/strict";
import { test } from "node:test";
import { queueEpicOperation } from "./operation-queue.js";
import { deferred } from "./store-test-helpers.js";
import { configureEpicTiming, type EpicTimingEntry } from "./timing.js";

test("queued cancellation skips obsolete work without overtaking the active lease", async (t) => {
  const entries: EpicTimingEntry[] = [];
  configureEpicTiming((entry) => entries.push(entry), true);
  t.after(() => configureEpicTiming(() => undefined, false));
  const lease = deferred<void>();
  const started = deferred<void>();
  const active = queueEpicOperation(undefined, async () => {
    started.resolve();
    await lease.promise;
  });
  await started.promise;
  const controller = new AbortController();
  let obsoleteRan = false;
  const obsolete = queueEpicOperation(
    active.queued,
    async () => {
      obsoleteRan = true;
    },
    controller.signal,
    { queue: "workspace" }
  );
  let latestRan = false;
  const latest = queueEpicOperation(obsolete.queued, async () => {
    latestRan = true;
  });
  const cancelled = assert.rejects(obsolete.result, {
    code: "operation-cancelled",
  });
  controller.abort();
  await cancelled;
  assert.equal(obsoleteRan, false);
  assert.equal(latestRan, false);
  lease.resolve();
  await latest.result;
  assert.equal(obsoleteRan, false);
  assert.equal(latestRan, true);
  assert.equal(
    entries.filter(
      (entry) =>
        entry.stage === "queue.wait" &&
        entry.event === "end" &&
        entry.queue === "workspace" &&
        entry.outcome === "cancelled"
    ).length,
    1
  );
  assert.equal(
    entries.some(
      (entry) => entry.stage === "queue.execute" && entry.queue === "workspace"
    ),
    false
  );
});

test("aborting a running task retains its lease until cleanup completes", async () => {
  const cleanup = deferred<void>();
  const started = deferred<void>();
  const controller = new AbortController();
  const active = queueEpicOperation(
    undefined,
    async () => {
      started.resolve();
      await cleanup.promise;
      throw new Error("cleanup completed");
    },
    controller.signal
  );
  await started.promise;
  let latestRan = false;
  const latest = queueEpicOperation(active.queued, async () => {
    latestRan = true;
  });
  const failed = assert.rejects(active.result, /cleanup completed/);
  controller.abort();
  await Promise.resolve();
  assert.equal(latestRan, false);
  cleanup.resolve();
  await failed;
  await latest.result;
  assert.equal(latestRan, true);
});
