import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { executeManagedLegendary } from "./legendary-managed-runtime.js";
import {
  epicPrerequisiteSupervisorScript,
  runElevatedEpicPrerequisite,
} from "./prerequisite-runtime.js";
import { deferred } from "./store-test-helpers.js";

const powershell = path.win32.join(
  process.env.SystemRoot || String.raw`C:\Windows`,
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);
const supervised = async (args: string[], cancellation: string) => {
  const script = path.join(path.dirname(cancellation), "supervisor.ps1");
  await fs.writeFile(
    script,
    epicPrerequisiteSupervisorScript(process.execPath, args, cancellation)
  );
  return executeManagedLegendary(
    powershell,
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      script,
    ],
    os.tmpdir(),
    { signal: new AbortController().signal }
  );
};

test(
  "Windows prerequisite job waits for descendants after the installer parent exits",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-prerequisite-job-")
    );
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, "finished");
    const child = `setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(file)}, 'complete'); }, 300)`;
    await supervised(
      [
        "-e",
        `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore', detached: true }).unref()`,
      ],
      path.join(directory, "cancel")
    );
    assert.equal(await fs.readFile(file, "utf8"), "complete");
  }
);

test(
  "Windows prerequisite cancellation stops an orphaned descendant before returning",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-prerequisite-job-")
    );
    const cancellation = path.join(directory, "cancel");
    const file = path.join(directory, "child-pid");
    const child = `require('node:fs').writeFileSync(${JSON.stringify(file)}, String(process.pid)); setInterval(() => {}, 1000)`;
    const operation = supervised(
      [
        "-e",
        `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'ignore', detached: true }).unref()`,
      ],
      cancellation
    );
    t.after(async () => {
      await fs.writeFile(cancellation, "cancel");
      await operation.catch(() => undefined);
      await fs.rm(directory, { recursive: true, force: true });
    });
    const deadline = Date.now() + 15_000;
    let pid: number | undefined;
    while (!pid && Date.now() < deadline) {
      pid = await fs.readFile(file, "utf8").then(Number, () => undefined);
      if (!pid) await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.ok(pid, "the supervised descendant started");
    await fs.writeFile(cancellation, "cancel");
    await operation;
    assert.throws(() => process.kill(pid!, 0), { code: "ESRCH" });
  }
);

test("UAC cancellation signals the supervisor and keeps the launcher alive until it exits", async () => {
  const controller = new AbortController();
  const ready = deferred<string>();
  const exited = deferred<void>();
  let completed = false;
  const operation = runElevatedEpicPrerequisite(
    process.execPath,
    [],
    controller.signal,
    async (_binary, args, _directory, options) => {
      const launcher = Buffer.from(args.at(-1)!, "base64").toString("utf16le");
      const supervisorPath = /-File "([^"]+)"/
        .exec(launcher)![1]
        .replaceAll("''", "'");
      const supervisor = await fs.readFile(supervisorPath, "utf8");
      const payload = JSON.parse(
        Buffer.from(
          /FromBase64String\('([a-zA-Z0-9+/=]+)'\)/.exec(supervisor)![1],
          "base64"
        ).toString("utf8")
      );
      ready.resolve(payload.cancellation);
      await exited.promise;
      assert.equal(
        options.signal.aborted,
        false,
        "the broker launcher is never killed to cancel the elevated job"
      );
      return { stdout: "", stderr: "" };
    }
  ).finally(() => {
    completed = true;
  });
  const cancellation = await ready.promise;
  controller.abort();
  for (
    let tries = 0;
    tries < 100 &&
    !(await fs.access(cancellation).then(
      () => true,
      () => false
    ));
    tries++
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(await fs.readFile(cancellation, "utf8"), "cancel");
  assert.equal(completed, false);
  exited.resolve();
  await assert.rejects(operation, { code: "operation-cancelled" });
  await assert.rejects(fs.access(cancellation), { code: "ENOENT" });
});
