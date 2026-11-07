import assert from "node:assert/strict";
import { test } from "node:test";
import type { Download } from "@types";
import { createDownloadRecordUpdater } from "./download-record-updater-core.js";

const download = { progress: 0, bytesDownloaded: 0 } as Download;

test("a failed write does not prevent later updates to the same download", async () => {
  let saved = download;
  let fail = true;
  const update = createDownloadRecordUpdater({
    get: async () => saved,
    put: async (_key, value) => {
      if (fail) {
        fail = false;
        throw new Error("disk write failed");
      }
      saved = value;
    },
  });
  const failed = update("game", { progress: 0.2 });
  const next = update("game", { bandwidthPriority: "high" });
  await assert.rejects(failed, /disk write failed/);
  await next;
  assert.equal(saved.bandwidthPriority, "high");
  assert.equal(saved.progress, 0);
});

test("a pending write does not block a different download", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const saved = new Map<string, Download>();
  const update = createDownloadRecordUpdater({
    get: async () => download,
    put: async (key, value) => {
      if (key === "slow") await gate;
      saved.set(key, value);
    },
  });
  const slow = update("slow", { progress: 0.2 });
  await update("fast", { progress: 0.5 });
  assert.equal(saved.get("fast")?.progress, 0.5);
  assert.equal(saved.has("slow"), false);
  release();
  await slow;
});

test("missing records and invalidated snapshots are not written", async () => {
  let writes = 0;
  const update = createDownloadRecordUpdater({
    get: async (key) => (key === "missing" ? undefined : download),
    put: async () => {
      writes++;
    },
  });
  assert.equal(await update("missing", { progress: 1 }), undefined);
  assert.equal(await update("stale", () => undefined), undefined);
  assert.equal(writes, 0);
});
