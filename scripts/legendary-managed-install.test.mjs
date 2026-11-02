import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";

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
  "targeted install runs the real pinned CLI, chunk workers and prerequisite recording using loopback only",
  {
    skip: !exists || !["linux", "win32"].includes(process.platform),
    timeout: 60_000,
  },
  async () => {
    const { stdout } = await run(
      binary,
      [
        ...(process.platform === "win32" ? ["-I", "-B"] : []),
        path.resolve("scripts/legendary-managed-install-fixture.py"),
      ],
      {
        shell: false,
        windowsHide: true,
        timeout: 50_000,
        maxBuffer: 256 * 1024,
      }
    );
    assert.match(stdout, /OFFLINE_REAL_INSTALL_OK /);
    const result = JSON.parse(
      stdout
        .split(/\r?\n/)
        .find((line) => line.startsWith("OFFLINE_REAL_INSTALL_OK "))
        .slice("OFFLINE_REAL_INSTALL_OK ".length)
    );
    assert.equal(result.version, "fixture-1");
    assert.equal(result.executable, "game.exe");
    assert.equal(result.requires_ot, true);
    assert.deepEqual(result.prerequisites, {
      ids: ["fixture-prereq"],
      name: "Fixture prerequisite",
      path: "setup.exe",
      args: "/quiet",
    });
  }
);
