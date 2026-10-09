import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  QUEUE_VERIFY_TTL_MS,
  clearVerifyAttempt,
  getQueueVerifySig,
  isVerifyAttemptFresh,
  recordVerifyAttempt,
} from "./download-queue-verify.ts";

describe("getQueueVerifySig", () => {
  it("returns null for missing and empty paths", async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "queue-verify-"));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    assert.equal(await getQueueVerifySig(path.join(root, "nope")), null);
    assert.equal(await getQueueVerifySig(root), null);
  });

  it("keeps directory signature across child content writes", async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "queue-verify-"));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const child = path.join(root, "part.bin");
    fs.writeFileSync(child, Buffer.alloc(7));
    const before = await getQueueVerifySig(root);
    assert.ok(before);
    fs.writeFileSync(child, Buffer.alloc(128));
    assert.equal(await getQueueVerifySig(root), before);
  });

  it("changes file signature with size", async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "queue-verify-"));
    t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
    const file = path.join(root, "game.zip");
    fs.writeFileSync(file, Buffer.alloc(7));
    const before = await getQueueVerifySig(file);
    fs.writeFileSync(file, Buffer.alloc(128));
    assert.notEqual(await getQueueVerifySig(file), before);
  });
});

describe("verify attempt cache", () => {
  it("blocks retries within TTL and allows after clear", () => {
    const attempts = new Map();
    const now = Date.now();
    assert.equal(isVerifyAttemptFresh(undefined, "s", now), false);
    recordVerifyAttempt(attempts, "k", "s", now);
    assert.equal(isVerifyAttemptFresh(attempts.get("k"), "s", now), true);
    assert.equal(isVerifyAttemptFresh(attempts.get("k"), "other", now), false);
    assert.equal(
      isVerifyAttemptFresh(
        attempts.get("k"),
        "s",
        now + QUEUE_VERIFY_TTL_MS + 1
      ),
      false
    );
    clearVerifyAttempt(attempts, "k");
    assert.equal(isVerifyAttemptFresh(attempts.get("k"), "s", now), false);
  });
});
