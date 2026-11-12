import assert from "node:assert/strict";
import { it } from "node:test";
import { GameRequestQueue } from "./game-request-queue.js";
it("orders a batch, tracking, and reset for the same game without blocking other games", async () => {
  const queue = new GameRequestQueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const actions: string[] = [];
  const batch = queue.run(
    ["A", "B", "A"],
    async () => {
      await gate;
      actions.push("batch");
    },
    () => true
  );
  const tracking = queue.run(
    ["A"],
    async () => {
      actions.push("tracking");
    },
    () => true
  );
  const reset = queue.run(
    ["A"],
    async () => {
      actions.push("reset");
    },
    () => true
  );
  await queue.run(
    ["C"],
    async () => {
      actions.push("other-game");
    },
    () => true
  );
  release();
  await Promise.all([batch, tracking, reset]);
  assert.deepEqual(actions, ["other-game", "batch", "tracking", "reset"]);
});
it("rejects old queued requests after a context change and recovers after failures", async () => {
  const queue = new GameRequestQueue();
  let release!: () => void;
  let current = true;
  const first = queue.run(
    ["A"],
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    () => true
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  const stale = queue.run(
    ["A"],
    async () => assert.fail("old request dispatched"),
    () => current
  );
  current = false;
  release();
  await first;
  await assert.rejects(stale, /library-context-changed/);
  await assert.rejects(
    queue.run(
      ["A"],
      async () => {
        throw new Error("network");
      },
      () => true
    )
  );
  assert.equal(
    await queue.run(
      ["A"],
      async () => "new",
      () => true
    ),
    "new"
  );
});
