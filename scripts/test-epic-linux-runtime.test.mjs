import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  installSmokeLoader,
  parseOptions,
} = require("./test-epic-linux-runtime.cjs");

test("smoke CLI accepts only binary/data paths and rejects code/dependency overrides", () => {
  const supplied = "opaque-';globalThis.smokeInjected=true;//";
  const options = parseOptions(["--data-dir", supplied, "--umu", "umu-run"]);
  assert.equal(options.get("--data-dir"), path.resolve(supplied));
  assert.equal(options.get("--umu"), path.resolve("umu-run"));
  for (const args of [
    ["--dependencies", "/untrusted-checkout"],
    ["--source", "/untrusted.ts"],
    ["--umu", "first", "--umu", "second"],
    ["--helper"],
    ["--fixture", "--umu"],
  ])
    assert.throws(() => parseOptions(args));
  assert.equal(global.smokeInjected, undefined);
});

test("the normal Node loader rejects TypeScript outside the checkout before executing it", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "epic-smoke-boundary-")
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const untrusted = path.join(directory, "untrusted.ts");
  await fs.writeFile(untrusted, "globalThis.smokeInjected = true; export {};");
  const stop = installSmokeLoader({});
  try {
    assert.throws(() => require(untrusted), /inside this checkout's src/);
    assert.equal(global.smokeInjected, undefined);
  } finally {
    stop();
  }
});

test("normal Node imports production runtime modules with object ports and clears its scoped cache", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "epic-smoke-import-")
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let preferenceReads = 0;
  const system = {
    SystemPath: {
      getPath: (name) => (name === "home" ? os.homedir() : directory),
    },
  };
  const stop = installSmokeLoader({
    electron: { app: { isPackaged: true } },
    "@main/level": {
      db: {
        get: async () => {
          preferenceReads++;
          return null;
        },
      },
      levelKeys: { userPreferences: "preferences" },
    },
    "../system-path": system,
    "./system-path": system,
    "./legendary": { Legendary: { getBinaryPath: () => null } },
    "./legendary-managed-runtime": {
      EpicManagedError: class extends Error {},
      managedWorkspacePath: () => directory,
    },
    "../umu": { Umu: {} },
  });
  const runtimeFile = require.resolve(
    "../src/main/services/epic/linux-runtime.ts"
  );
  try {
    const runtime = require(runtimeFile);
    assert.equal(require(runtimeFile), runtime);
    assert.equal(typeof runtime.ensureEpicLinuxPrerequisites, "function");
    const prefix = await runtime.resolveEpicLinuxPrefixPath(
      { winePrefixPath: path.join(directory, "prefix") },
      { environment: "test", userId: "user", epicAccountId: "account" },
      "Artifact"
    );
    assert.equal(prefix, path.join(await fs.realpath(directory), "prefix"));
    assert.equal(preferenceReads, 1);
    assert.equal(await runtime.getEpicLinuxPrefixGeneration(prefix), null);
    await assert.rejects(fs.stat(prefix), { code: "ENOENT" });
  } finally {
    stop();
  }
  assert.equal(require.cache[runtimeFile], undefined);
});
