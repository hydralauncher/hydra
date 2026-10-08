import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { linuxFixture } from "./legendary-linux-fixture.mjs";

const require = createRequire(import.meta.url);
const { prepareLegendary, sha256File } = require("./prepare-legendary.cjs");
const {
  extractDebianData,
  getLinuxRuntime,
  runtimeFiles,
  verifyLinuxRuntime,
} = require("./legendary-linux-runtime.cjs");
const manifest = require("../src/shared/legendary-manifest.json");

for (const arch of ["x64", "arm64"]) {
  test(`Linux ${arch} packages the official zipapp with its own Python and libc`, async (t) => {
    const f = await linuxFixture(t, arch);
    const prepared = await prepareLegendary(f.options);
    const bundle = path.dirname(prepared.binaryPath);
    assert.equal(prepared.cached, false);
    assert.equal(f.requests.length, 3);
    assert.equal(
      await fs.readFile(path.join(bundle, "legendary.pyz"), "utf8"),
      `official Legendary fixture ${arch}`
    );
    const wrapper = await fs.readFile(prepared.binaryPath, "utf8");
    assert.ok(wrapper.includes('"$runtime/python-runner"'));
    assert.ok(wrapper.includes('"$runtime/legendary.pyz" "$@"'));
    const pythonWrapper = await fs.readFile(
      path.join(bundle, "python-runner"),
      "utf8"
    );
    assert.ok(pythonWrapper.includes(f.runtime.glibc.loader));
    assert.ok(
      pythonWrapper.includes('"$runtime/python/bin/python3.13" -I -B "$@"')
    );
    assert.doesNotMatch(pythonWrapper, /\/usr\/bin\/python|apt |pip install/);
    assert.ok(
      (
        await fs.readFile(
          path.join(bundle, "licenses/THIRD_PARTY_NOTICES.txt"),
          "utf8"
        )
      ).endsWith("libc license fixture")
    );
    assert.equal(await verifyLinuxRuntime(bundle, undefined, sha256File), true);
    assert.deepEqual(
      await fs.readdir(path.join(f.projectDir, "legendary/linux")),
      [arch]
    );
    if (process.platform !== "win32") {
      assert.equal((await fs.stat(prepared.binaryPath)).mode & 0o777, 0o755);
      assert.equal(
        (await fs.stat(path.join(bundle, "glibc", f.runtime.glibc.loader)))
          .mode & 0o777,
        0o755
      );
    }

    const cached = await prepareLegendary({
      ...f.options,
      fetchImpl: () => assert.fail("verified cache must not download"),
    });
    assert.equal(cached.cached, true);
  });
}

test("a corrupt Python/libc/launcher cache is repaired from verified archives without system Python", async (t) => {
  const f = await linuxFixture(t);
  const prepared = await prepareLegendary(f.options);
  const bundle = path.dirname(prepared.binaryPath);
  for (const name of [
    "legendary",
    "legendary.pyz",
    "python/bin/python3.13",
    "glibc/libc.so.6",
    "python/lib/python3.13/site-packages/sitecustomize.py",
  ]) {
    await fs.writeFile(path.join(bundle, name), "corrupted");
    assert.equal(
      await verifyLinuxRuntime(bundle, undefined, sha256File),
      false
    );
    const repaired = await prepareLegendary({
      ...f.options,
      fetchImpl: () => assert.fail("valid archives must be reused"),
    });
    assert.equal(repaired.cached, false);
    assert.equal(await verifyLinuxRuntime(bundle, undefined, sha256File), true);
  }
  await fs.rm(path.join(bundle, "glibc", f.runtime.glibc.loader));
  assert.equal((await prepareLegendary(f.options)).cached, false);
});

test("an invalid runtime checksum fails preparation and preserves the existing bundle", async (t) => {
  const f = await linuxFixture(t);
  const prepared = await prepareLegendary(f.options);
  const before = await fs.readFile(
    path.join(path.dirname(prepared.binaryPath), ".runtime-files.json")
  );
  const changed = structuredClone(f.artifactManifest);
  changed.linuxRuntime.artifacts.arm64.python.sha256 = "f".repeat(64);
  await assert.rejects(
    prepareLegendary({ ...f.options, artifactManifest: changed }),
    /checksum mismatch/
  );
  assert.deepEqual(
    await fs.readFile(
      path.join(path.dirname(prepared.binaryPath), ".runtime-files.json")
    ),
    before
  );
  assert.equal(
    await verifyLinuxRuntime(
      path.dirname(prepared.binaryPath),
      undefined,
      sha256File
    ),
    true
  );
});

test("interrupted downloads settle and leave no partial runtime or temporary files", async (t) => {
  const f = await linuxFixture(t);
  await assert.rejects(
    prepareLegendary({
      ...f.options,
      fetchImpl: async (url) =>
        url === f.runtime.python.url
          ? new Response(
              new ReadableStream({
                pull(controller) {
                  controller.error(new Error("interrupted"));
                },
              })
            )
          : f.options.fetchImpl(url),
    }),
    /interrupted/
  );
  await assert.rejects(
    fs.stat(path.join(f.projectDir, "legendary/linux/arm64")),
    { code: "ENOENT" }
  );
  const cache = await fs.readdir(
    path.join(f.projectDir, "legendary/.downloads/arm64")
  );
  assert.ok(cache.every((name) => !name.includes(".download-")));
});

test("Linux preparation leaves cached Windows/macOS artifacts intact", async (t) => {
  const f = await linuxFixture(t);
  const foreign = path.join(f.projectDir, "legendary/darwin/arm64");
  await fs.mkdir(foreign, { recursive: true });
  await fs.writeFile(
    path.join(foreign, "legendary"),
    "existing Mac executable"
  );
  await prepareLegendary(f.options);
  assert.equal(
    await fs.readFile(path.join(foreign, "legendary"), "utf8"),
    "existing Mac executable"
  );
});

test("concurrent preparation serializes the same target and removes staging directories", async (t) => {
  const f = await linuxFixture(t);
  const results = await Promise.all([
    prepareLegendary(f.options),
    prepareLegendary(f.options),
  ]);
  assert.deepEqual(
    results.map((result) => result.cached),
    [false, true]
  );
  assert.equal(f.requests.length, 3);
  assert.deepEqual(
    await fs.readdir(path.join(f.projectDir, "legendary/linux")),
    ["arm64"]
  );
});

test("incomplete libc/Python manifests and malformed Debian archives fail safely", () => {
  assert.throws(
    () => getLinuxRuntime({ ...manifest, linuxRuntime: {} }, "arm64"),
    /Invalid/
  );
  assert.throws(
    () => extractDebianData(Buffer.from("not a Debian archive")),
    /Invalid/
  );
  assert.throws(() => extractDebianData(Buffer.from("!<arch>\n")), /no data/);
});

test("parallel runtime hashing preserves deterministic traversal and bounds open files", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "legendary-inventory-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const expected = [
    "Z-upper",
    "a/one",
    "a/sub/two",
    "a.json",
    ...Array.from({ length: 16 }, (_, i) => `b${String(i).padStart(2, "0")}`),
    "z-lower",
  ];
  await Promise.all(
    [...expected, "LICENSE", "NOTICE.md", ".runtime-files.json"].map(
      async (name) => {
        const file = path.join(root, name);
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, name);
      }
    )
  );
  let active = 0;
  let maximum = 0;
  const files = await runtimeFiles(root, async (file) => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      await setTimeout(path.basename(file) === "Z-upper" ? 30 : 5);
      return await sha256File(file);
    } finally {
      active--;
    }
  });
  assert.deepEqual(
    files.map((file) => file.name),
    expected
  );
  assert.ok(maximum > 1, "hashing should overlap");
  assert.ok(maximum <= 8, `too many concurrent hashes: ${maximum}`);
  assert.equal(active, 0);
});

test(
  "runtime hashing accepts internal symlinks and rejects escaping or absolute targets",
  { skip: process.platform === "win32" },
  async (t) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "legendary-symlinks-")
    );
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, "target"), "runtime");
    const link = path.join(root, "link");
    await fs.symlink("target", link);
    const files = await runtimeFiles(root, sha256File);
    assert.deepEqual(files[0], { name: "link", target: "target" });
    await fs.rm(link);
    await fs.symlink("../outside", link);
    await assert.rejects(runtimeFiles(root, sha256File), /external symlink/);
    await fs.rm(link);
    await fs.symlink(path.join(root, "target"), link);
    await assert.rejects(runtimeFiles(root, sha256File), /external symlink/);
  }
);
