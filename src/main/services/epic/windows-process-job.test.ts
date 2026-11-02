import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getManagedEpicProcessCommand } from "./windows-process-job.js";

const helperDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "legendary",
  "win32",
  process.arch
);

async function temporaryDirectory(
  t: { after: (cleanup: () => Promise<void>) => void },
  clean = true
) {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-compiled-job-")
  );
  if (clean) t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function run(command: { binary: string; args: string[] }) {
  const process = spawn(command.binary, command.args, {
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  process.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
  process.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
  return new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolve, reject) => {
      process.once("error", reject);
      process.once("close", (code) => resolve({ stdout, stderr, code }));
    }
  );
}

test("compiled supervisor uses a private request and validates its packaged checksum", async (t) => {
  const directory = await temporaryDirectory(t);
  const payload = Buffer.from("verified executable");
  await fs.writeFile(path.join(directory, "hydra-epic-process.exe"), payload);
  await fs.writeFile(
    path.join(directory, "hydra-epic-process.json"),
    JSON.stringify({
      protocol: 1,
      fileName: "hydra-epic-process.exe",
      sourceSha256: "0".repeat(64),
      sha256: createHash("sha256").update(payload).digest("hex"),
    })
  );
  const requestDirectory = await temporaryDirectory(t);
  const cancellation = path.join(requestDirectory, "cancel");
  const command = await getManagedEpicProcessCommand(
    directory,
    process.execPath,
    ["--version", "private argument"],
    cancellation
  );
  assert.deepEqual(command.args, [
    "--request",
    path.join(requestDirectory, "request.json"),
  ]);
  assert.deepEqual(JSON.parse(await fs.readFile(command.args[1], "utf8")), {
    protocol: 1,
    executable: process.execPath,
    arguments: ["--version", "private argument"],
    cancellation,
  });
  const corruptDirectory = await temporaryDirectory(t);
  await fs.cp(directory, corruptDirectory, { recursive: true });
  await fs.writeFile(
    path.join(corruptDirectory, "hydra-epic-process.exe"),
    "corrupt"
  );
  await assert.rejects(
    getManagedEpicProcessCommand(
      corruptDirectory,
      process.execPath,
      [],
      cancellation
    ),
    /Invalid Epic process supervisor/
  );
});

test(
  "compiled Windows supervisor preserves Unicode, empty arguments, quotes, trailing slashes and stderr",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await temporaryDirectory(t);
    const args = ["", "á 空格", 'a"b', String.raw`a\\"b`, "C:\\space here\\"];
    const command = await getManagedEpicProcessCommand(
      helperDirectory,
      process.execPath,
      [
        "-e",
        "process.stdout.write(JSON.stringify(process.argv.slice(1))); process.stderr.write('known stderr')",
        "--",
        ...args,
      ],
      path.join(directory, "cancel")
    );
    const result = await run(command);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "known stderr");
    assert.deepEqual(JSON.parse(result.stdout), args);
  }
);

test(
  "compiled Windows supervisor returns full DWORD exit codes",
  { skip: process.platform !== "win32" },
  async (t) => {
    for (const code of [3010, 1641, -19088744]) {
      const directory = await temporaryDirectory(t);
      const result = await run(
        await getManagedEpicProcessCommand(
          helperDirectory,
          process.execPath,
          ["-e", `process.exit(${code})`],
          path.join(directory, "cancel")
        )
      );
      assert.equal(result.code! >>> 0, code >>> 0);
    }
  }
);

test(
  "compiled Windows supervisor waits for reparented descendants",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await temporaryDirectory(t);
    const finished = path.join(directory, "finished");
    const child = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(finished)}, 'complete'), 250)`;
    const result = await run(
      await getManagedEpicProcessCommand(
        helperDirectory,
        process.execPath,
        [
          "-e",
          `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], {stdio:'ignore',detached:true}).unref()`,
        ],
        path.join(directory, "cancel")
      )
    );
    assert.equal(result.code, 0);
    assert.equal(await fs.readFile(finished, "utf8"), "complete");
  }
);

test(
  "compiled Windows cancellation returns only after orphaned descendants stop",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await temporaryDirectory(t, false);
    const cancellation = path.join(directory, "cancel");
    const pidFile = path.join(directory, "child-pid");
    const child = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;
    const operation = run(
      await getManagedEpicProcessCommand(
        helperDirectory,
        process.execPath,
        [
          "-e",
          `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], {stdio:'ignore',detached:true}).unref()`,
        ],
        cancellation
      )
    );
    t.after(async () => {
      await fs.writeFile(cancellation, "cancel");
      await operation;
      await fs.rm(directory, { recursive: true, force: true });
    });
    const deadline = Date.now() + 15_000;
    let pid: number | undefined;
    while (!pid && Date.now() < deadline) {
      pid = await fs.readFile(pidFile, "utf8").then(Number, () => undefined);
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(pid, "the descendant started");
    await fs.writeFile(cancellation, "cancel");
    await operation;
    assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
  }
);

test(
  "compiled Windows job closes descendants if its supervisor exits unexpectedly",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await temporaryDirectory(t, false);
    const cancellation = path.join(directory, "cancel");
    const pidFile = path.join(directory, "child-pid");
    const command = await getManagedEpicProcessCommand(
      helperDirectory,
      process.execPath,
      [
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`,
      ],
      cancellation
    );
    const supervisor = spawn(command.binary, command.args, {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    const closed = new Promise<void>((resolve, reject) => {
      supervisor.once("close", () => resolve());
      supervisor.once("error", reject);
    });
    t.after(async () => {
      supervisor.kill();
      await closed;
      await fs.rm(directory, { recursive: true, force: true });
    });
    const deadline = Date.now() + 15_000;
    let pid: number | undefined;
    while (!pid && Date.now() < deadline) {
      pid = await fs.readFile(pidFile, "utf8").then(Number, () => undefined);
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(pid, "the descendant started");
    supervisor.kill();
    await closed;
    const stopDeadline = Date.now() + 5_000;
    while (Date.now() < stopDeadline) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
  }
);

test(
  "compiled Windows supervisor reports only native spawn errors",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await temporaryDirectory(t);
    const result = await run(
      await getManagedEpicProcessCommand(
        helperDirectory,
        path.join(directory, "private-missing.exe"),
        ["private argument"],
        path.join(directory, "cancel")
      )
    );
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trim(), "HYDRA_PROCESS_SPAWN_ERROR:2");
  }
);
