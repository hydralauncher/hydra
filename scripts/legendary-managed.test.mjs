import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const { verifyManagedRuntime } = require("./legendary-managed-runtime.cjs");
const { sha256File } = require("./prepare-legendary.cjs");
const run = promisify(execFile);
const directory = path.resolve("legendary", process.platform, process.arch);
const binary = path.join(
  directory,
  process.platform === "win32" ? "python/python.exe" : "python-runner"
);
const exists = await fs.stat(binary).then(
  () => true,
  () => false
);

test(
  "targeted Legendary package uses pinned modules, AES and exact-target parser regressions",
  {
    skip: !exists || !["linux", "win32"].includes(process.platform),
    timeout: 30_000,
  },
  async () => {
    assert.equal(
      await verifyManagedRuntime(directory, undefined, sha256File),
      true
    );
    const prefix = process.platform === "win32" ? ["-I", "-B"] : [];
    const { stdout } = await run(
      binary,
      [
        ...prefix,
        path.join(directory, "managed.py"),
        path.join(directory, "managed-legendary.pyz"),
        "--capabilities",
      ],
      { windowsHide: true, timeout: 10_000 }
    );
    assert.deepEqual(JSON.parse(stdout).capabilities, [
      "inspect-target",
      "install-target",
      "access-only",
      "refresh-session",
    ]);
    const result = await run(
      binary,
      [
        ...prefix,
        path.resolve("scripts/legendary-managed-fixture.py"),
        directory,
      ],
      { windowsHide: true, timeout: 20_000 }
    );
    assert.match(result.stderr, /Ran 22 tests/);
    assert.match(result.stderr, /\bOK\b/);
  }
);
