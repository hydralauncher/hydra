import * as stringDecoder from "node:string_decoder";
import assert from "node:assert/strict";
import {
  execFile,
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";
import ts from "typescript";
import * as protocol from "./auth-protocol.ts";
import { bundle } from "./store-test-helpers.ts";

const TEST_TIMEOUT_MS = 30_000;
const PROCESS_STOP_TIMEOUT_MS = 10_000;
const PROCESS_POLL_INTERVAL_MS = 20;
const CREDENTIAL_CANARY = "epic-runner-credential-canary";
const TEST_BINARY = "controlled-legendary-cli";
type LegendaryRunner = Awaited<
  ReturnType<typeof import("./legendary-auth").LegendaryAuthRunner.create>
>;
const execFileAsync = promisify(execFile);
const authenticatedBundle = {
  user: {
    ...bundle.user,
    access_token: CREDENTIAL_CANARY,
    refresh_token: `${CREDENTIAL_CANARY}-refresh`,
  },
  version: bundle.version,
};
const source = await fs.readFile(
  new URL("./legendary-auth.ts", import.meta.url),
  "utf8"
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;

const cliSource = String.raw`
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const settings = require("./settings.json");
const args = process.argv.slice(2);
const keepAlive = () => setInterval(() => {}, settings.keepAliveInterval);
const write = (stream, contents) => new Promise((resolve, reject) => {
  stream.write(contents, (error) => error ? reject(error) : resolve());
});

async function main() {
  if (args[0] === "--descendant") {
    keepAlive();
    process.send("ready");
    return;
  }
  const directory = process.env.LEGENDARY_CONFIG_PATH;
  const mode = args[args.indexOf("--code") + 1];
  if (args[0] !== "--api-timeout" || args[2] !== "auth" || args[3] !== "--code") {
    process.exitCode = 2;
    return;
  }
  if (mode === "nonzero") {
    await write(process.stderr, settings.canary);
    process.exitCode = 1;
    return;
  }
  if (mode === "revoked-credentials" || mode === "offline-refresh") {
    await write(process.stderr, settings.canary);
    await write(process.stderr, mode === "revoked-credentials"
      ? '\n[Core] ERROR: Stored credentials are no longer valid! Please login again.\n'
      : '\n[Core] ERROR: HTTP request for login failed: ConnectionError, please try again later.\n');
    process.exitCode = 1;
    return;
  }
  const files = { "user.json": settings.bundle.user, "version.json": settings.bundle.version };
  if (mode === "invalid-session") files["user.json"].account_id = "invalid";
  if (mode === "session-client") files["user.json"].client_id = "wrong";
  if (mode === "invalid-version") files["version.json"] = { data: "invalid" };
  if (mode === "version-client") files["version.json"] = { data: { egl_config: { client_id: "wrong" } } };
  for (const [name, value] of Object.entries(files)) {
    const suffix = name === "user.json" ? "user" : "version";
    const file = path.join(directory, name);
    if (mode === "missing-" + suffix) continue;
    if (mode === "directory-" + suffix) {
      await fs.mkdir(file);
    } else if (mode === "malformed-" + suffix) {
      await fs.writeFile(file, '{"token":"' + settings.canary + '",');
    } else if (mode === "oversized-" + suffix) {
      await fs.writeFile(file, Buffer.alloc(settings.maxFileBytes + 1, "x"));
    } else {
      await fs.writeFile(file, JSON.stringify(value));
    }
  }
  if (mode.startsWith("output-")) {
    const overflow = mode !== "output-limit";
    const total = settings.maxOutputBytes + (overflow ? 1 : 0);
    if (overflow) keepAlive();
    const output = Buffer.alloc(total, "x");
    output.write(settings.canary);
    if (mode === "output-over-stdout") {
      await write(process.stdout, output);
    } else if (mode === "output-over-stderr") {
      await write(process.stderr, output);
    } else {
      const midpoint = Math.floor(total / 2);
      await write(process.stdout, output.subarray(0, midpoint));
      await write(process.stderr, output.subarray(midpoint));
    }
  }
  if (mode === "hold-tree") {
    const descendant = spawn(process.execPath, [__filename, "--descendant"], {
      windowsHide: true,
      detached: false,
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    await new Promise((resolve, reject) => {
      descendant.once("message", resolve);
      descendant.once("error", reject);
    });
    keepAlive();
    await write(process.stdout, JSON.stringify({ pid: process.pid, descendantPid: descendant.pid }) + "\n");
  }
}
main().catch(async () => {
  await write(process.stderr, settings.canary);
  process.exitCode = 1;
});
`;

async function isRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const stat = await fs.readFile(`/proc/${pid}/stat`, "utf8");
      if (stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")) return false;
    }
    return true;
  } catch (error) {
    if (["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code!))
      return false;
    throw error;
  }
}

async function waitUntilStopped(pids: number[]) {
  const deadline = Date.now() + PROCESS_STOP_TIMEOUT_MS;
  while ((await Promise.all(pids.map(isRunning))).some(Boolean)) {
    assert.ok(Date.now() < deadline, "controlled process tree must stop");
    await new Promise((resolve) =>
      setTimeout(resolve, PROCESS_POLL_INTERVAL_MS)
    );
  }
}

async function terminateOwnedProcess(pid: number, group: boolean) {
  if (process.platform === "win32") {
    await execFileAsync(
      path.join(
        process.env.SystemRoot || String.raw`C:\Windows`,
        "System32",
        "taskkill.exe"
      ),
      ["/PID", String(pid), "/T", "/F"],
      { windowsHide: true, timeout: PROCESS_STOP_TIMEOUT_MS }
    );
  } else {
    try {
      process.kill(group ? -pid : pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
}

async function fixture(
  t: TestContext,
  options: { controlTimeout?: boolean; spawnFailure?: boolean } = {}
) {
  const temporaryDirectory = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(
    path.join(temporaryDirectory, "epic-runner-test-")
  );
  const cli = path.join(root, "legendary-fixture.cjs");
  const userData = path.join(root, "user-data");
  const temporaryRoot = path.join(userData, "epic-temporary");
  const controller = new AbortController();
  const runners: LegendaryRunner[] = [];
  const pending: Promise<unknown>[] = [];
  const processes: {
    child: ChildProcess;
    closed: boolean;
    close: Promise<void>;
    descendantPid?: number;
  }[] = [];
  const calls: { binary: string; args: string[]; directory?: string }[] = [];
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  const controlledHandles = new WeakSet<object>();
  let resolveReady!: (value: { pid: number; descendantPid: number }) => void;
  const ready = new Promise<{ pid: number; descendantPid: number }>(
    (resolve) => {
      resolveReady = resolve;
    }
  );
  const module = {} as typeof import("./legendary-auth");
  const modules: Record<string, unknown> = {
    "node:string_decoder": stringDecoder,
    "node:fs/promises": fs,
    "node:path": path,
    "./auth-protocol.js": protocol,
    "node:child_process": {
      execFile,
      spawn: (binary: string, args: string[], spawnOptions: SpawnOptions) => {
        assert.equal(binary, TEST_BINARY);
        assert.equal(spawnOptions.shell, false);
        assert.equal(spawnOptions.windowsHide, true);
        assert.equal(spawnOptions.detached, process.platform !== "win32");
        assert.equal(
          JSON.stringify(spawnOptions.stdio),
          JSON.stringify(["ignore", "pipe", "pipe"])
        );
        calls.push({
          binary,
          args: Array.from(args),
          directory: spawnOptions.env?.LEGENDARY_CONFIG_PATH,
        });
        const child = spawn(
          options.spawnFailure
            ? path.join(root, "missing-executable")
            : process.execPath,
          [cli, ...args],
          spawnOptions
        );
        let resolveClose!: () => void;
        const record = {
          child,
          closed: false,
          close: new Promise<void>((resolve) => {
            resolveClose = resolve;
          }),
          descendantPid: undefined as number | undefined,
        };
        processes.push(record);
        child.once("close", () => {
          record.closed = true;
          resolveClose();
        });
        if (args.at(-1) === "hold-tree") {
          let line = "";
          child.stdout!.on("data", (chunk: Buffer) => {
            line += chunk.toString("utf8");
            if (line.includes("\n")) {
              const value = JSON.parse(line.trim()) as {
                pid: number;
                descendantPid: number;
              };
              record.descendantPid = value.descendantPid;
              resolveReady(value);
            }
          });
        }
        return child;
      },
    },
  };
  vm.runInNewContext(compiled, {
    exports: module,
    require: (specifier: string) =>
      modules[specifier] ?? assert.fail(`Unexpected dependency: ${specifier}`),
    process,
    Buffer,
    setTimeout: (callback: () => void, delay: number) => {
      if (
        options.controlTimeout &&
        delay === module.EPIC_LEGENDARY_PROCESS_TIMEOUT_MS
      ) {
        const handle = {} as ReturnType<typeof setTimeout>;
        controlledHandles.add(handle);
        timers.set(handle, callback);
        return handle;
      }
      return setTimeout(callback, delay);
    },
    clearTimeout: (handle: ReturnType<typeof setTimeout>) => {
      if (controlledHandles.has(handle)) timers.delete(handle);
      else clearTimeout(handle);
    },
  });
  t.after(async () => {
    controller.abort();
    for (const record of processes) {
      if (
        !record.closed &&
        record.child.pid &&
        (await isRunning(record.child.pid))
      ) {
        await terminateOwnedProcess(record.child.pid, true);
      } else if (
        !record.closed &&
        record.descendantPid &&
        (await isRunning(record.descendantPid))
      ) {
        await terminateOwnedProcess(record.descendantPid, false);
      }
    }
    await Promise.allSettled(pending);
    await Promise.all(processes.map((record) => record.close));
    await Promise.all(runners.map((runner) => runner.cleanup()));
    assert.equal(path.dirname(root), temporaryDirectory);
    assert.ok(path.basename(root).startsWith("epic-runner-test-"));
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(cli, cliSource);
  await fs.writeFile(
    path.join(root, "settings.json"),
    JSON.stringify({
      canary: CREDENTIAL_CANARY,
      bundle: authenticatedBundle,
      maxOutputBytes: module.EPIC_LEGENDARY_MAX_OUTPUT_BYTES,
      maxFileBytes: module.EPIC_SESSION_MAX_FILE_BYTES,
      keepAliveInterval: PROCESS_POLL_INTERVAL_MS,
    })
  );
  return {
    module,
    controller,
    root,
    userData,
    temporaryRoot,
    calls,
    ready,
    async create() {
      const runner = await module.LegendaryAuthRunner.create(
        TEST_BINARY,
        userData,
        controller.signal
      );
      runners.push(runner);
      const entries = await fs.readdir(temporaryRoot);
      const directory = path.join(temporaryRoot, entries.at(-1)!);
      return { runner, directory };
    },
    authenticate(runner: LegendaryRunner, mode: string) {
      const promise = runner.authenticate(mode);
      pending.push(promise);
      void promise.catch(() => {});
      return promise;
    },
    expireProcessTimeout() {
      assert.equal(timers.size, 1);
      [...timers.values()][0]();
      assert.equal(timers.size, 0);
    },
  };
}

async function expectSafeError(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof protocol.EpicIntegrationError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    assert.equal("cause" in error, false);
    assert.equal(JSON.stringify(error).includes(CREDENTIAL_CANARY), false);
    return true;
  });
}

for (const mode of ["revoked-credentials", "offline-refresh"] as const) {
  test(`existing session classifies ${mode} without exposing diagnostic credentials`, async (t) => {
    const f = await fixture(t);
    const { directory } = await f.create();
    await expectSafeError(
      f.module.executeLegendaryCommand(
        TEST_BINARY,
        ["--api-timeout", "15", "auth", "--code", mode],
        {
          encoding: "utf8",
          env: { ...process.env, LEGENDARY_CONFIG_PATH: directory },
          sessionRequired: true,
          timeout: TEST_TIMEOUT_MS,
        }
      ),
      mode === "revoked-credentials" ? "session-expired" : "auth-failed"
    );
  });
}

test(
  "real runner authenticates in a fresh private directory and cleanup is repeatable",
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const f = await fixture(t);
    const { runner, directory } = await f.create();
    assert.deepEqual(await fs.readdir(directory), ["config.ini"]);
    const result = await f.authenticate(runner, "valid");
    assert.deepEqual(JSON.parse(JSON.stringify(result)), authenticatedBundle);
    assert.deepEqual(f.calls[0].args, [
      "--api-timeout",
      String(f.module.EPIC_LEGENDARY_API_TIMEOUT_SECONDS),
      "auth",
      "--code",
      "valid",
    ]);
    assert.equal(f.calls[0].directory, directory);
    if (process.platform !== "win32") {
      for (const dir of [f.temporaryRoot, directory])
        assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
      for (const name of ["config.ini", "user.json", "version.json"])
        assert.equal(
          (await fs.stat(path.join(directory, name))).mode & 0o777,
          0o600
        );
    }
    await expectSafeError(f.authenticate(runner, "valid"), "auth-failed");
    assert.equal(f.calls.length, 1);
    await runner.cleanup();
    await runner.cleanup();
    assert.deepEqual(await fs.readdir(f.temporaryRoot), []);
    const fresh = await f.create();
    assert.notEqual(fresh.directory, directory);
    assert.deepEqual(await fs.readdir(fresh.directory), ["config.ini"]);
    assert.deepEqual(
      JSON.parse(JSON.stringify(await f.authenticate(fresh.runner, "valid"))),
      authenticatedBundle
    );
  }
);

for (const mode of [
  "missing-user",
  "missing-version",
  "malformed-user",
  "malformed-version",
  "directory-user",
  "directory-version",
  "oversized-user",
  "oversized-version",
  "invalid-session",
  "nonzero",
]) {
  test(
    `real runner rejects ${mode} without exposing credentials`,
    { timeout: TEST_TIMEOUT_MS },
    async (t) => {
      const f = await fixture(t);
      const { runner } = await f.create();
      await expectSafeError(f.authenticate(runner, mode), "auth-failed");
    }
  );
}

for (const [mode, code] of [
  ["invalid-version", "invalid-response"],
  ["session-client", "oauth-client-mismatch"],
  ["version-client", "oauth-client-mismatch"],
]) {
  test(
    `real runner validates ${mode}`,
    { timeout: TEST_TIMEOUT_MS },
    async (t) => {
      const f = await fixture(t);
      const { runner } = await f.create();
      await expectSafeError(f.authenticate(runner, mode), code);
    }
  );
}

test(
  "real spawn failure is sanitized",
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const f = await fixture(t, { spawnFailure: true });
    const { runner } = await f.create();
    await expectSafeError(f.authenticate(runner, "valid"), "auth-failed");
  }
);

test(
  "stdout and stderr combined at the output limit are accepted",
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const f = await fixture(t);
    const { runner } = await f.create();
    assert.deepEqual(
      JSON.parse(JSON.stringify(await f.authenticate(runner, "output-limit"))),
      authenticatedBundle
    );
  }
);

for (const mode of [
  "output-over-stdout",
  "output-over-stderr",
  "output-over-combined",
]) {
  test(
    `${mode} stops the real process and returns a fixed error`,
    { timeout: TEST_TIMEOUT_MS },
    async (t) => {
      const f = await fixture(t);
      const { runner } = await f.create();
      await expectSafeError(f.authenticate(runner, mode), "auth-failed");
    }
  );
}

test(
  "abort before create or authenticate launches no process",
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const early = await fixture(t);
    early.controller.abort();
    await expectSafeError(early.create(), "operation-cancelled");
    assert.equal(early.calls.length, 0);
    const later = await fixture(t);
    const { runner } = await later.create();
    later.controller.abort();
    await expectSafeError(
      later.authenticate(runner, "valid"),
      "operation-cancelled"
    );
    assert.equal(later.calls.length, 0);
  }
);

for (const interruption of ["abort", "timeout"] as const) {
  test(
    `${interruption} stops the real process and its descendant`,
    { timeout: TEST_TIMEOUT_MS },
    async (t) => {
      const f = await fixture(t, {
        controlTimeout: interruption === "timeout",
      });
      const { runner, directory } = await f.create();
      const authentication = f.authenticate(runner, "hold-tree");
      const { pid, descendantPid } = await f.ready;
      assert.equal(await isRunning(pid), true);
      assert.equal(await isRunning(descendantPid), true);
      if (interruption === "abort") f.controller.abort();
      else f.expireProcessTimeout();
      await expectSafeError(
        authentication,
        interruption === "abort" ? "operation-cancelled" : "timeout"
      );
      await waitUntilStopped([pid, descendantPid]);
      await runner.cleanup();
      await assert.rejects(fs.stat(directory), { code: "ENOENT" });
    }
  );
}

test(
  "startup cleanup removes only operation directories",
  { timeout: TEST_TIMEOUT_MS },
  async (t) => {
    const f = await fixture(t);
    const { directory } = await f.create();
    const keep = path.join(f.temporaryRoot, "keep-me");
    await fs.mkdir(keep);
    await fs.writeFile(path.join(keep, "keep.txt"), "preserved");
    await f.module.cleanupEpicTemporarySessions(f.userData);
    await assert.rejects(fs.stat(directory), { code: "ENOENT" });
    assert.equal(
      await fs.readFile(path.join(keep, "keep.txt"), "utf8"),
      "preserved"
    );
    await f.module.cleanupEpicTemporarySessions(f.userData);
  }
);
