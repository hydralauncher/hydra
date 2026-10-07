import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkEpicBinary,
  getEpicBinaryAvailability,
} from "./binary-preparation.ts";

test("checks a regular file without executing it, checking version, or caching existence", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-binary-test-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = path.join(root, "legendary");
  // This is deliberately neither executable nor version output.
  await fs.writeFile(binary, "not an executable", { mode: 0o600 });
  assert.deepEqual(getEpicBinaryAvailability(binary), { available: true });
  assert.equal(await checkEpicBinary(binary), binary);
  await fs.rm(binary);
  assert.deepEqual(getEpicBinaryAvailability(binary), {
    available: false,
    reason: "legendary-missing",
  });
  await assert.rejects(checkEpicBinary(binary), {
    message: "legendary-missing",
  });
});

test("directories and paths below a regular file are missing binaries", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-binary-test-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "file");
  await fs.writeFile(file, "fixture");
  for (const binary of [root, path.join(file, "legendary")]) {
    assert.deepEqual(getEpicBinaryAvailability(binary), {
      available: false,
      reason: "legendary-missing",
    });
    await assert.rejects(checkEpicBinary(binary), {
      message: "legendary-missing",
    });
  }
});

test("an unresolved binary path never inspects the filesystem", async () => {
  assert.deepEqual(
    getEpicBinaryAvailability(null, () => assert.fail("unexpected stat")),
    { available: false, reason: "legendary-missing" }
  );
  await assert.rejects(
    checkEpicBinary(null, {
      inspect: async () => assert.fail("unexpected stat"),
    }),
    { message: "legendary-missing" }
  );
});

for (const code of ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EIO"]) {
  test(`binary inspection maps ${code} safely in availability and preparation`, async () => {
    const failure = Object.assign(new Error("sensitive path detail"), { code });
    const expected =
      code === "ENOENT" || code === "ENOTDIR"
        ? "legendary-missing"
        : "legendary-unavailable";
    assert.deepEqual(
      getEpicBinaryAvailability("/pinned/legendary", () => {
        throw failure;
      }),
      { available: false, reason: expected }
    );
    await assert.rejects(
      checkEpicBinary("/pinned/legendary", {
        inspect: async () => {
          throw failure;
        },
      }),
      { message: expected }
    );
  });
}

test("pending cleanup completes before inspection; failure blocks preparation and can retry", async () => {
  let failCleanup = true;
  let inspected = 0;
  const options = {
    cleanup: async () => {
      if (failCleanup) throw new Error("sensitive cleanup error");
    },
    inspect: async () => {
      inspected++;
      return { isFile: () => true };
    },
  };
  await assert.rejects(checkEpicBinary("/pinned/legendary", options), {
    message: "cleanup-failed",
  });
  assert.equal(inspected, 0);
  failCleanup = false;
  assert.equal(
    await checkEpicBinary("/pinned/legendary", options),
    "/pinned/legendary"
  );
  assert.equal(inspected, 1);
});
