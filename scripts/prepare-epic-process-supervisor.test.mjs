import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const {
  prepareEpicProcessSupervisor,
  verifyEpicProcessSupervisor,
  writeEpicProcessSupervisorReceipt,
} = require("./prepare-epic-process-supervisor.cjs");
const execFileAsync = promisify(execFile);

test("supervisor receipt verifies binary/source identity and is updated after signing", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-job-build-")
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const binary = path.join(directory, "hydra-epic-process.exe");
  const sourceHash = createHash("sha256").update("source").digest("hex");
  await fs.writeFile(binary, "unsigned executable");
  await writeEpicProcessSupervisorReceipt(directory, sourceHash);
  assert.equal(await verifyEpicProcessSupervisor(directory, sourceHash), true);
  assert.equal(
    await verifyEpicProcessSupervisor(directory, "0".repeat(64)),
    false
  );
  await fs.appendFile(binary, "signed payload");
  assert.equal(await verifyEpicProcessSupervisor(directory, sourceHash), false);
  const receipt = await writeEpicProcessSupervisorReceipt(directory);
  assert.equal(receipt.protocol, 1);
  assert.equal(receipt.sourceSha256, sourceHash);
  assert.equal(await verifyEpicProcessSupervisor(directory, sourceHash), true);
  await fs.writeFile(
    path.join(directory, "hydra-epic-process.json"),
    JSON.stringify({ ...receipt, protocol: 2 })
  );
  assert.equal(await verifyEpicProcessSupervisor(directory), false);
  await assert.rejects(writeEpicProcessSupervisorReceipt(directory), /receipt/);
});

test("non-Windows preparation does not invoke a compiler", async () => {
  assert.equal(await prepareEpicProcessSupervisor({ platform: "linux" }), null);
});

test(
  "Windows build produces a verified executable with the expected protocol and cache",
  { skip: process.platform !== "win32" },
  async (t) => {
    const projectDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-job-project-")
    );
    t.after(() => fs.rm(projectDir, { recursive: true, force: true }));
    const sourceDirectory = path.join(
      projectDir,
      "native",
      "windows-epic-process"
    );
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.copyFile(
      new URL("../native/windows-epic-process/supervisor.cs", import.meta.url),
      path.join(sourceDirectory, "supervisor.cs")
    );
    const first = await prepareEpicProcessSupervisor({ projectDir });
    assert.equal(first.cached, false);
    const { stdout } = await execFileAsync(first.binaryPath, ["--version"], {
      windowsHide: true,
      shell: false,
    });
    assert.equal(stdout.trim(), "hydra-epic-process protocol=1");
    assert.equal(
      await verifyEpicProcessSupervisor(path.dirname(first.binaryPath)),
      true
    );
    const second = await prepareEpicProcessSupervisor({ projectDir });
    assert.equal(second.cached, true);
  }
);
