import assert from "node:assert/strict";
import { test } from "node:test";
import { AchievementSyncCoordinator } from "./achievement-sync-coordinator.js";
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
test("different games share one achievement HTTP queue", async () => {
  const queue = new AchievementSyncCoordinator();
  const gate = deferred();
  const events: string[] = [];
  const first = queue.runRequest(
    "A",
    async () => {
      events.push("A-start");
      await gate.promise;
      events.push("A-end");
    },
    () => true
  );
  const second = queue.runRequest(
    "B",
    async () => {
      events.push("B");
    },
    () => true
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["A-start"]);
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["A-start", "A-end", "B"]);
});
test("same-game merges serialize without blocking another game's local work", async () => {
  const queue = new AchievementSyncCoordinator();
  const gate = deferred();
  const events: string[] = [];
  const first = queue.runMerge("A", async () => {
    events.push("first");
    await gate.promise;
  });
  const second = queue.runMerge("A", async () => {
    events.push("second");
  });
  await queue.runMerge("B", async () => {
    events.push("other");
  });
  assert.deepEqual(events, ["first", "other"]);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(events.at(-1), "second");
});
test("account changes discard queued requests and stale responses", async () => {
  const queue = new AchievementSyncCoordinator();
  const gate = deferred();
  let current = true;
  let sent = 0;
  const first = queue.runRequest(
    "A",
    async () => {
      sent++;
      await gate.promise;
    },
    () => current
  );
  const second = queue.runRequest(
    "B",
    async () => {
      sent++;
    },
    () => current
  );
  const assertions = [assert.rejects(first), assert.rejects(second)];
  await new Promise((resolve) => setImmediate(resolve));
  current = false;
  gate.resolve();
  await Promise.all(assertions);
  assert.equal(sent, 1);
  await queue.runRequest(
    "B",
    async () => {
      sent++;
    },
    () => true
  );
  assert.equal(sent, 2);
});
test("reset drains the sent PUT and cancels queued stale writes before deleting", async () => {
  const queue = new AchievementSyncCoordinator();
  const gate = deferred();
  const events: string[] = [];
  const first = queue.runRequest(
    "A",
    async () => {
      events.push("PUT");
      await gate.promise;
    },
    () => true
  );
  const stale = queue.runRequest(
    "A",
    async () => {
      events.push("stale-PUT");
    },
    () => true
  );
  const assertions = [assert.rejects(first), assert.rejects(stale)];
  await new Promise((resolve) => setImmediate(resolve));
  const reset = queue.resetGame("A", async () => {
    events.push("DELETE");
  });
  const during = assert.rejects(
    queue.runMerge("A", async () => {
      events.push("stale-merge");
    })
  );
  gate.resolve();
  await Promise.all([...assertions, reset, during]);
  assert.deepEqual(events, ["PUT", "DELETE"]);
  await queue.runRequest(
    "A",
    async () => {
      events.push("new-PUT");
    },
    () => true
  );
  assert.equal(events.at(-1), "new-PUT");
});

const withinDeadline = async <T>(promise: Promise<T>) => {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Operation stalled")), 250);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
};

test("reset can wait for a worker whose reconciliation is canceled", async () => {
  const queue = new AchievementSyncCoordinator();
  await withinDeadline(
    queue.resetGame("A", async () => {
      await assert.rejects(queue.runMerge("A", async () => {}));
    })
  );
});

test("overlapping resets keep new writes canceled until both finish", async () => {
  const queue = new AchievementSyncCoordinator();
  const firstGate = deferred();
  const secondGate = deferred();
  const secondStarted = deferred();
  const first = queue.resetGame("A", () => firstGate.promise);
  const second = queue.resetGame("A", async () => {
    secondStarted.resolve();
    await secondGate.promise;
  });
  firstGate.resolve();
  await first;
  await secondStarted.promise;
  try {
    await assert.rejects(
      queue.runRequest(
        "A",
        async () => {},
        () => true
      )
    );
  } finally {
    secondGate.resolve();
    await second;
  }
});
