import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createEpicAuthRuntime } from "./auth-runtime.ts";

for (const platform of ["linux", "darwin", "win32"]) {
  for (const arch of ["x64", "arm64"]) {
    test(`${platform}/${arch} checks the embedded launcher and defers Legendary execution until login`, async (t) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "epic-runtime-"));
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const binary = path.join(root, "legendary");
      await fs.writeFile(binary, "embedded launcher fixture");
      let creates = 0;
      const runtime = createEpicAuthRuntime({
        platform,
        arch,
        userDataPath: root,
        getBinaryPath: () => binary,
        createLegendaryRunner: async (file, directory, signal) => {
          assert.equal(file, binary);
          assert.equal(directory, root);
          assert.equal(signal.aborted, false);
          creates++;
          return {} as never;
        },
      });
      assert.deepEqual(runtime.availability(), { available: true });
      const create = await runtime.prepareAuthRunner();
      assert.equal(creates, 0);
      await create(new AbortController().signal);
      assert.equal(creates, 1);
      await fs.rm(binary);
      assert.deepEqual(runtime.availability(), {
        available: false,
        reason: "legendary-missing",
      });
      await assert.rejects(runtime.prepareAuthRunner(), /legendary-missing/);
      assert.equal(creates, 1);
    });
  }
}

test("unsupported targets never read files or construct a runner", async () => {
  for (const [platform, arch, error] of [
    ["freebsd", "x64", "unsupported-platform"],
    ["linux", "ia32", "unsupported-architecture"],
    ["linux", "riscv64", "unsupported-architecture"],
  ]) {
    const runtime = createEpicAuthRuntime({
      platform,
      arch,
      userDataPath: "/unused",
      getBinaryPath: () =>
        assert.fail("unsupported target must not read files"),
    });
    assert.deepEqual(runtime.availability(), {
      available: false,
      reason: error,
    });
    await assert.rejects(runtime.prepareAuthRunner(), new RegExp(error));
  }
});

test("Linux retries abandoned temporary cleanup before allowing Legendary auth", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "epic-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const binary = path.join(root, "legendary");
  await fs.writeFile(binary, "fixture");
  let fail = true;
  let creates = 0;
  const runtime = createEpicAuthRuntime({
    platform: "linux",
    arch: "arm64",
    userDataPath: root,
    getBinaryPath: () => binary,
    cleanup: async () => {
      if (fail) throw Error("private path");
    },
    createLegendaryRunner: async () => {
      creates++;
      return {} as never;
    },
  });
  await assert.rejects(runtime.prepareAuthRunner(), /cleanup-failed/);
  assert.equal(creates, 0);
  fail = false;
  const create = await runtime.prepareAuthRunner();
  await create(new AbortController().signal);
  assert.equal(creates, 1);
});
