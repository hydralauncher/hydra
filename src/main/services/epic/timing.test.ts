import assert from "node:assert/strict";
import { test } from "node:test";
import {
  configureEpicTiming,
  markEpicTiming,
  withEpicTiming,
  type EpicTimingDetails,
  type EpicTimingEntry,
} from "./timing.js";

test("disabled diagnostics preserve the task result without writing", async () => {
  let written = false;
  configureEpicTiming(() => {
    written = true;
  }, false);
  const result = {};
  assert.equal(
    await withEpicTiming("test.disabled", async () => result),
    result
  );
  assert.equal(written, false);
});

test("nested stages share a trace, filter private details and have monotonic times", async () => {
  const entries: EpicTimingEntry[] = [];
  configureEpicTiming((entry) => entries.push(entry), true);
  try {
    await withEpicTiming("test.root", async () => {
      await withEpicTiming("test.child", async () => {
        markEpicTiming("test.mark", {
          command: "info",
          token: "secret",
          path: "private",
        } as EpicTimingDetails);
      });
    });
    const root = entries.find(
      (entry) => entry.stage === "test.root" && entry.event === "start"
    )!;
    const child = entries.find(
      (entry) => entry.stage === "test.child" && entry.event === "start"
    )!;
    assert.equal(child.traceId, root.traceId);
    assert.equal(child.parentSpanId, root.spanId);
    assert.ok(entries.every((entry) => entry.traceId === root.traceId));
    assert.ok(entries.every((entry) => Number.isFinite(entry.atMs)));
    assert.ok(
      entries
        .filter((entry) => entry.event === "end")
        .every((entry) => entry.durationMs! >= 0)
    );
    assert.equal(JSON.stringify(entries).includes("secret"), false);
    assert.equal(JSON.stringify(entries).includes("private"), false);
  } finally {
    configureEpicTiming(() => {}, false);
  }
});

test("a failing diagnostic writer cannot replace results or cancellation", async () => {
  configureEpicTiming(() => {
    throw new Error("writer failed");
  }, true);
  const failure = Object.assign(new Error("cancelled"), {
    code: "operation-cancelled",
  });
  try {
    assert.equal(await withEpicTiming("test.success", async () => 42), 42);
    await assert.rejects(
      withEpicTiming("test.cancel", async () => {
        throw failure;
      }),
      (error) => error === failure
    );
  } finally {
    configureEpicTiming(() => {}, false);
  }
});
