import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import {
  type ChildProcess,
  type execFile,
  type spawn,
} from "node:child_process";
import { EPIC_OAUTH_CLIENT_ID } from "./auth-protocol.ts";
import {
  cleanupEpicTemporarySessions,
  getEpicTemporaryRoot,
  LegendaryAuthRunner,
  EPIC_LEGENDARY_PROCESS_TIMEOUT_MS,
  executeLegendaryCommand,
  taskkillLegendaryTree,
  EPIC_LEGENDARY_TERMINATION_TIMEOUT_MS,
} from "./legendary-auth.ts";

const user = () => ({
  account_id: "a".repeat(32),
  displayName: "Test Epic",
  access_token: "test-access",
  refresh_token: "test-refresh",
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  client_id: EPIC_OAUTH_CLIENT_ID,
});
const version = {
  last_update: 123,
  data: { egl_config: { client_id: EPIC_OAUTH_CLIENT_ID } },
};

test("uses fresh restricted configuration, bounded shell-free commands, latest refreshed session, and cleans secrets", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-runner-test-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let directory = "";
  const commands: string[][] = [];
  const runner = await LegendaryAuthRunner.create(
    "/pinned/legendary",
    root,
    new AbortController().signal,
    async (binary, args, options) => {
      assert.equal(binary, "/pinned/legendary");
      assert.equal(options.shell, false);
      assert.equal(options.timeout, EPIC_LEGENDARY_PROCESS_TIMEOUT_MS);
      assert.deepEqual(args.slice(0, 2), ["--api-timeout", "15"]);
      directory = options.env!.LEGENDARY_CONFIG_PATH!;
      commands.push(args.slice(2));
      if (args[2] === "auth") {
        await assert.rejects(fs.access(path.join(directory, "user.json")));
        await fs.writeFile(
          path.join(directory, "user.json"),
          JSON.stringify(user())
        );
        await fs.writeFile(
          path.join(directory, "version.json"),
          JSON.stringify(version)
        );
        return "";
      }
      await fs.writeFile(
        path.join(directory, "user.json"),
        JSON.stringify({ ...user(), refresh_token: "test-refreshed" })
      );
      return JSON.stringify({ code: "testExchangeCode123456789" });
    }
  );
  await runner.authenticate("testAuthorizationCode123456789");
  assert.equal(await runner.getExchangeCode(), "testExchangeCode123456789");
  assert.equal(
    (await runner.readBundle()).user.refresh_token,
    "test-refreshed"
  );
  assert.deepEqual(commands, [
    ["auth", "--code", "testAuthorizationCode123456789"],
    ["get-token", "--json"],
  ]);
  if (process.platform !== "win32") {
    assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
    assert.equal(
      (await fs.stat(path.join(directory, "user.json"))).mode & 0o777,
      0o600
    );
  }
  await runner.cleanup();
  await assert.rejects(fs.access(directory));
});

test("exit zero without fresh user.json cannot authenticate", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-empty-test-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runner = await LegendaryAuthRunner.create(
    "/fake",
    root,
    new AbortController().signal,
    async () => ""
  );
  await assert.rejects(
    runner.authenticate("testAuthorizationCode123456789"),
    /auth-failed/
  );
  await runner.cleanup();
});

test("an old session is rejected before auth execution", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-epic-old-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let calls = 0;
  const runner = await LegendaryAuthRunner.create(
    "/fake",
    root,
    new AbortController().signal,
    async () => {
      calls++;
      return "";
    }
  );
  const [directory] = await fs.readdir(getEpicTemporaryRoot(root));
  await fs.writeFile(
    path.join(getEpicTemporaryRoot(root), directory, "user.json"),
    JSON.stringify(user())
  );
  await assert.rejects(
    runner.authenticate("testAuthorizationCode123456789"),
    /auth-failed/
  );
  assert.equal(calls, 0);
  await runner.cleanup();
});

test("crash recovery removes only operation directories and does not run Legendary", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-crash-test-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const temporary = getEpicTemporaryRoot(root);
  await fs.mkdir(path.join(temporary, "operation-crashed"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(temporary, "operation-crashed", "user.json"),
    "test-only"
  );
  await fs.writeFile(path.join(temporary, "keep.txt"), "keep");
  await cleanupEpicTemporarySessions(root);
  assert.deepEqual(await fs.readdir(temporary), ["keep.txt"]);
});

test("raw process errors and their credentials never escape", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-error-test-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runner = await LegendaryAuthRunner.create(
    "/fake",
    root,
    new AbortController().signal,
    async () => {
      throw new Error("process arguments SECRET_CODE SECRET_TOKEN");
    }
  );
  await assert.rejects(
    runner.authenticate("testAuthorizationCode123456789"),
    (error: Error) => {
      assert.equal(error.message, "auth-failed");
      assert.equal(JSON.stringify(error).includes("SECRET"), false);
      return true;
    }
  );
  await runner.cleanup();
});

test("Windows cancellation kills entire process tree before resolving, without passing credentials to taskkill", async () => {
  const controller = new AbortController();
  const child = Object.assign(new EventEmitter(), {
    pid: 4321,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  }) as unknown as ChildProcess;
  let killStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    killStarted = resolve;
  });
  let completeKill!: () => void;
  let detached: boolean | undefined;
  let settled = false;
  const result = executeLegendaryCommand(
    "C:\\legendary.exe",
    ["auth", "--code", "SECRET_TEST_CODE"],
    {
      signal: controller.signal,
      timeout: 5000,
    },
    {
      platform: "win32",
      spawn: ((_file, _args, options) => {
        detached = options.detached;
        return child;
      }) as typeof spawn,
      taskkill: async (pid) => {
        assert.equal(pid, 4321);
        killStarted();
        await new Promise<void>((resolve) => {
          completeKill = resolve;
        });
      },
    }
  );
  const checked = result.catch((error: Error) => {
    settled = true;
    assert.equal(error.message, "operation-cancelled");
  });
  controller.abort();
  await started;
  assert.equal(detached, false);
  assert.equal(settled, false);
  child.emit("close", null, "SIGKILL");
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    settled,
    false,
    "closing the parent is insufficient while tree termination is pending"
  );
  completeKill();
  await checked;
});

test("Windows taskkill is hidden, shell-free, bounded, and scoped only to owned PID tree", async () => {
  let invoked = false;
  const fake = ((_file, args, options, callback) => {
    invoked = true;
    assert.match(_file as string, /System32\\taskkill\.exe$/);
    assert.deepEqual(args, ["/PID", "4321", "/T", "/F"]);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, EPIC_LEGENDARY_TERMINATION_TIMEOUT_MS);
    callback(null, "", "");
  }) as unknown as typeof execFile;
  await taskkillLegendaryTree(4321, fake);
  assert.equal(invoked, true);
  await assert.rejects(taskkillLegendaryTree(-4321, fake), /cleanup-failed/);
});

test("failed process-tree termination preserves temporary directory until a successful retry", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-epic-tree-failure-test-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const controller = new AbortController();
  const child = Object.assign(new EventEmitter(), {
    pid: 4321,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  }) as unknown as ChildProcess;
  let killFails = true;
  let ready!: () => void;
  const spawned = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const runner = await LegendaryAuthRunner.create(
    "C:\\legendary.exe",
    root,
    controller.signal,
    (file, args, options) =>
      executeLegendaryCommand(file, args, options, {
        platform: "win32",
        spawn: (() => {
          ready();
          return child;
        }) as typeof spawn,
        taskkill: async () => {
          if (killFails) throw new Error("SECRET_OS_ERROR");
          child.emit("close", null, "SIGKILL");
        },
      })
  );
  const attempt = runner.authenticate("testAuthorizationCode123456789");
  await spawned;
  controller.abort();
  await assert.rejects(attempt, /cleanup-failed/);
  await assert.rejects(runner.cleanup(), /cleanup-failed/);
  assert.equal((await fs.readdir(getEpicTemporaryRoot(root))).length, 1);
  killFails = false;
  await runner.cleanup();
  assert.equal((await fs.readdir(getEpicTemporaryRoot(root))).length, 0);
});

const waitForFile = async (file: string) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      return await fs.readFile(file, "utf8");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error("fixture process did not start");
};

for (const interruption of ["abort", "timeout"] as const) {
  test(
    `POSIX ${interruption} stops descendant writes before temporary cleanup`,
    { skip: process.platform === "win32" },
    async (t) => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "hydra-epic-tree-test-")
      );
      t.after(() => fs.rm(root, { recursive: true, force: true }));
      const pidsFile = path.join(root, "pids.json");
      const heartbeatFile = path.join(root, "heartbeat.txt");
      const childScript = `const fs=require('node:fs');setInterval(()=>fs.appendFileSync(${JSON.stringify(heartbeatFile)}, 'x'), 10);`;
      const parentScript = `const{spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(childScript)}],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(pidsFile)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`;
      const controller = new AbortController();
      const command = executeLegendaryCommand(
        process.execPath,
        ["-e", parentScript],
        {
          signal: controller.signal,
          timeout: interruption === "timeout" ? 2000 : 5000,
        }
      );
      const checked = assert.rejects(
        command,
        new RegExp(
          interruption === "timeout" ? "timeout" : "operation-cancelled"
        )
      );
      const pids: number[] = JSON.parse(await waitForFile(pidsFile));
      t.after(() => {
        for (const pid of pids) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* Already stopped. */
          }
        }
      });
      await waitForFile(heartbeatFile);
      if (interruption === "abort") controller.abort();
      await checked;
      const finalHeartbeat = await fs.readFile(heartbeatFile, "utf8");
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(await fs.readFile(heartbeatFile, "utf8"), finalHeartbeat);
      for (const pid of pids)
        assert.throws(
          () => process.kill(pid, 0),
          (error: NodeJS.ErrnoException) => error.code === "ESRCH"
        );
    }
  );
}

test("oversized process output stops execution and never exposes buffered secrets", async () => {
  const script =
    "process.stdout.write('SECRET_TEST_TOKEN');process.stderr.write('x'.repeat(100000));setInterval(()=>{},1000);";
  await assert.rejects(
    executeLegendaryCommand(process.execPath, ["-e", script], {
      timeout: 5000,
      maxBuffer: 128,
    }),
    (error: Error) => {
      assert.equal(error.message, "auth-failed");
      assert.equal(JSON.stringify(error).includes("SECRET_TEST_TOKEN"), false);
      return true;
    }
  );
});
