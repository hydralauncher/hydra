import assert from "node:assert/strict";
import { it } from "node:test";
import {
  LibraryWriteQueue,
  hasPendingHydraClaim,
  withHydraClaim,
} from "./library-write-queue.js";
it("finishes old writes before cleanup and rejects queued stale-context writes", async () => {
  const queue = new LibraryWriteQueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let current = true;
  const writes: string[] = [];
  const first = queue.run(async () => {
    await gate;
    writes.push("old-write");
  });
  await Promise.resolve();
  current = false;
  const cleanup = queue.run(async () => {
    writes.push("cleanup");
  });
  const stale = queue.run(
    async () => {
      writes.push("resurrect-old-import");
    },
    () => current
  );
  release();
  await first;
  await cleanup;
  await assert.rejects(stale, /library-context-changed/);
  assert.deepEqual(writes, ["old-write", "cleanup"]);
  await queue.run(async () => {
    writes.push("new-account");
  });
});
it("protects a zero-time explicit Hydra claim until its operation finishes", async () => {
  const key = "epic:namespace:item";
  await withHydraClaim(key, async () => {
    assert.equal(hasPendingHydraClaim(key), true);
  });
  assert.equal(hasPendingHydraClaim(key), false);
  await assert.rejects(
    withHydraClaim(key, async () => {
      throw new Error("offline");
    })
  );
  assert.equal(hasPendingHydraClaim(key), false);
});
