import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  spawnSupervisedUmu,
  parseLinuxProcessIdentity,
  inspectLinuxPrefixProcesses,
} from "./umu-supervised-process.js";

const DESCENDANT_COMPLETION_DELAY_MS = 700;
const TOOL_TIMEOUT_MS = 10_000;
const DEADLINE_DESCENDANT_LIFETIME_MS = 10_000;
const TOOL_DEADLINE_MS = 600;

function fakeSpawn() {
  const child = Object.assign(new EventEmitter(), {
    pid: 87654321,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => {
      child.emit("close", null, "SIGKILL");
      return true;
    },
  });
  let received: unknown[] = [];
  const spawn = (...args: unknown[]) => {
    received = args;
    setImmediate(() => child.emit("spawn"));
    return child;
  };
  return { child, spawn, received: () => received };
}

test("Linux identity parsing handles process names with spaces and parentheses", () => {
  const fields = ["S", "42", ...Array(17).fill("0"), "123456789"];
  const parsed = parseLinuxProcessIdentity(
    43,
    `43 (odd ) process) ${fields.join(" ")}`
  );
  assert.deepEqual(parsed, {
    pid: 43,
    parentPid: 42,
    startTime: "123456789",
    state: "S",
  });
});

test("authenticated process returns at spawn, adds marker and drains output without exposing credentials", async () => {
  const fixture = fakeSpawn();
  const emitted: string[] = [];
  const handle = await spawnSupervisedUmu({
    executable: "/private/python-runner",
    args: ["umu", "game.exe", "-AUTH_PASSWORD=synthetic-secret"],
    cwd: "/game",
    environment: { WINEPREFIX: "/prefix", PROTON_LOG: "0" },
    onLine: (line) => emitted.push(line),
    spawnProcess: fixture.spawn as never,
  });
  assert.equal(handle.pid, fixture.child.pid);
  assert.match(handle.invocationId, /^[a-f0-9-]{36}$/);
  const options = fixture.received()[2] as {
    env: Record<string, string>;
    shell: boolean;
    stdio: string[];
  };
  assert.equal(options.env.HYDRA_EPIC_INVOCATION_ID, handle.invocationId);
  assert.equal(options.shell, false);
  assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe"]);
  fixture.child.stdout.write("-AUTH_PASSWORD=synthetic-secret\n");
  fixture.child.stderr.write("spawn failed args synthetic-secret\n");
  fixture.child.emit("close", 0, null);
  assert.deepEqual(await handle.output, { stdout: "", stderr: "" });
  assert.deepEqual(emitted, []);
  assert.deepEqual(await handle.exited, { code: 0, signal: null });
});

test("private unauthenticated capture handles fragmented UTF8 without logging", async () => {
  const fixture = fakeSpawn();
  const lines: string[] = [];
  const handle = await spawnSupervisedUmu({
    executable: "python",
    args: ["umu", "createprefix"],
    cwd: "/prefix",
    environment: {},
    captureOutput: true,
    onLine: (line) => lines.push(line),
    spawnProcess: fixture.spawn as never,
  });
  const text = Buffer.from("PROTONPATH=/Games/Próton\n");
  fixture.child.stdout.write(text.subarray(0, text.length - 3));
  fixture.child.stdout.write(text.subarray(text.length - 3));
  fixture.child.emit("close", 0, null);
  assert.equal((await handle.output).stdout, "PROTONPATH=/Games/Próton\n");
  assert.deepEqual(lines, ["PROTONPATH=/Games/Próton"]);
});

test("already cancelled invocation never starts a process", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    spawnSupervisedUmu({
      executable: "python",
      args: [],
      cwd: "/prefix",
      environment: {},
      signal: controller.signal,
      spawnProcess: (() => {
        called = true;
      }) as never,
    }),
    { code: "operation-cancelled" }
  );
  assert.equal(called, false);
});

test(
  "natural tree completion waits for a child in a new session after its wrapper exits",
  { skip: process.platform !== "linux" },
  async (t) => {
    // Exercise the production supervisor with real children while an unrelated
    // same-UID process has a protected environment, as desktop daemons can.
    const protectedPid = 87654320;
    const readdir = fs.readdir.bind(fs);
    const stat = fs.stat.bind(fs);
    const readFile = fs.readFile.bind(fs);
    t.mock.method(
      fs,
      "readdir",
      async (...args: Parameters<typeof fs.readdir>) => {
        const entries = await readdir(...args);
        return args[0] === "/proc"
          ? [...entries, String(protectedPid)]
          : entries;
      }
    );
    t.mock.method(fs, "stat", async (...args: Parameters<typeof fs.stat>) =>
      args[0] === `/proc/${protectedPid}`
        ? { uid: process.getuid!() }
        : stat(...args)
    );
    t.mock.method(
      fs,
      "readFile",
      async (...args: Parameters<typeof fs.readFile>) => {
        if (args[0] === `/proc/${protectedPid}/environ`)
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        if (args[0] === `/proc/${protectedPid}/stat`)
          return `${protectedPid} (desktop-daemon) ${["S", "1", ...Array(17).fill("0"), "10"].join(" ")}`;
        return readFile(...args);
      }
    );
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "umu-tree-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const marker = path.join(directory, "completed");
    const descendant = `setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'complete'), ${DESCENDANT_COMPLETION_DELAY_MS})`;
    const wrapper =
      "const p=require('node:child_process').spawn(process.execPath,['-e',process.argv[1],process.argv[2]],{env:process.env,detached:true,stdio:'ignore'});p.unref();";
    const handle = await spawnSupervisedUmu({
      executable: process.execPath,
      args: ["-e", wrapper, descendant, marker],
      cwd: directory,
      environment: process.env,
      timeoutMs: TOOL_TIMEOUT_MS,
    });
    t.after(() => handle.terminate());
    assert.equal((await handle.exited).code, 0);
    assert.equal(
      await fs.stat(marker).then(
        () => true,
        () => false
      ),
      false
    );
    await handle.waitForTreeExit();
    assert.equal(await fs.readFile(marker, "utf8"), "complete");
  }
);

test(
  "tool deadline still terminates an attributed detached child after wrapper success",
  { skip: process.platform !== "linux" },
  async (t) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "umu-timeout-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const marker = path.join(directory, "must-not-complete");
    const descendant = `setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'wrong'), ${DEADLINE_DESCENDANT_LIFETIME_MS})`;
    const wrapper =
      "const p=require('node:child_process').spawn(process.execPath,['-e',process.argv[1],process.argv[2]],{env:process.env,detached:true,stdio:'ignore'});p.unref();";
    const handle = await spawnSupervisedUmu({
      executable: process.execPath,
      args: ["-e", wrapper, descendant, marker],
      cwd: directory,
      environment: process.env,
      timeoutMs: TOOL_DEADLINE_MS,
    });
    t.after(() => handle.terminate());
    assert.equal((await handle.exited).code, 0);
    await assert.rejects(handle.waitForTreeExit(), { code: "timeout" });
    await handle.terminate();
    assert.equal(
      await fs.stat(marker).then(
        () => true,
        () => false
      ),
      false
    );
  }
);

for (const interruption of ["cancel", "timeout"] as const) {
  test(
    `an unreadable known process cannot leave ${interruption} waiting for wrapper exit`,
    { skip: process.platform !== "linux" },
    async (t) => {
      const fixture = fakeSpawn();
      const controller = new AbortController();
      let alive = true,
        denied = false;
      const readdir = fs.readdir.bind(fs),
        stat = fs.stat.bind(fs),
        readFile = fs.readFile.bind(fs);
      const directory = `/proc/${fixture.child.pid}`;
      t.mock.method(
        fs,
        "readdir",
        async (...args: Parameters<typeof fs.readdir>) =>
          args[0] === "/proc"
            ? alive
              ? [String(fixture.child.pid)]
              : []
            : readdir(...args)
      );
      t.mock.method(fs, "stat", async (...args: Parameters<typeof fs.stat>) =>
        args[0] === directory ? { uid: process.getuid!() } : stat(...args)
      );
      t.mock.method(
        fs,
        "readFile",
        async (...args: Parameters<typeof fs.readFile>) => {
          if (String(args[0]).startsWith(directory + "/")) {
            if (denied)
              throw Object.assign(new Error("denied"), { code: "EACCES" });
            if (String(args[0]).endsWith("/stat"))
              return `${fixture.child.pid} (umu) ${["S", "1", ...Array(17).fill("0"), "10"].join(" ")}`;
            const options = fixture.received()[2] as {
              env: Record<string, string>;
            };
            return Buffer.from(
              `HYDRA_EPIC_INVOCATION_ID=${options.env.HYDRA_EPIC_INVOCATION_ID}\0`
            );
          }
          return readFile(...args);
        }
      );
      const handle = await spawnSupervisedUmu({
        executable: "python",
        args: ["umu", "--probe"],
        cwd: "/prefix",
        environment: {},
        signal: controller.signal,
        timeoutMs: interruption === "timeout" ? 30 : undefined,
        spawnProcess: fixture.spawn as never,
      });
      t.after(async () => {
        denied = false;
        alive = false;
        fixture.child.emit("close", 0, null);
        await handle.terminate();
      });
      let wrapperExited = false;
      void handle.exited.then(() => {
        wrapperExited = true;
      });
      denied = true;
      if (interruption === "cancel") controller.abort();
      await assert.rejects(
        handle.waitForTreeExit(),
        (error: { code?: string }) =>
          [
            "cleanup-failed",
            interruption === "cancel" ? "operation-cancelled" : "timeout",
          ].includes(error.code ?? "")
      );
      assert.equal(wrapperExited, false);
      await assert.rejects(handle.terminate(), { code: "cleanup-failed" });
    }
  );
}

function processInspectionPort(options: {
  environment?: string;
  denied?: boolean | "EACCES" | "EPERM";
  reused?: boolean;
  vanished?: boolean;
  zombie?: boolean;
}) {
  let statReads = 0;
  return {
    readdir: async () => ["100"],
    stat: async () => ({ uid: process.getuid?.() ?? 0 }),
    readFile: async (file: string) => {
      if (options.vanished)
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      if (file.endsWith("/environ")) {
        if (options.denied)
          throw Object.assign(new Error("denied"), {
            code:
              typeof options.denied === "string" ? options.denied : "EACCES",
          });
        return Buffer.from(options.environment ?? "");
      }
      statReads++;
      return `100 (wine) ${[options.zombie ? "Z" : "S", "1", ...Array(17).fill("0"), options.reused && statReads > 1 ? "20" : "10"].join(" ")}`;
    },
    realpath: async (value: string) =>
      ["/compat/pfx", "/alias"].includes(value) ? "/prefix" : value,
  };
}

test("prefix inspection requires evidence of the target Wine or Steam prefix", async () => {
  assert.equal(
    await inspectLinuxPrefixProcesses(
      "/prefix",
      processInspectionPort({ environment: "WINEPREFIX=/prefix\0" }) as never
    ),
    true
  );
  assert.equal(
    await inspectLinuxPrefixProcesses(
      "/prefix",
      processInspectionPort({
        environment: "STEAM_COMPAT_DATA_PATH=/compat\0",
      }) as never
    ),
    true
  );
  assert.equal(
    await inspectLinuxPrefixProcesses(
      "/prefix",
      processInspectionPort({ denied: true }) as never
    ),
    false
  );
  assert.equal(
    await inspectLinuxPrefixProcesses(
      "/prefix",
      processInspectionPort({ reused: true }) as never
    ),
    false
  );
  assert.equal(
    await inspectLinuxPrefixProcesses(
      "/prefix",
      processInspectionPort({ environment: "WINEPREFIX=/other\0" }) as never
    ),
    false
  );
  assert.equal(
    await inspectLinuxPrefixProcesses(
      "/prefix",
      processInspectionPort({ vanished: true }) as never
    ),
    false
  );
  assert.equal(
    await inspectLinuxPrefixProcesses(
      "/prefix",
      processInspectionPort({ zombie: true, denied: true }) as never
    ),
    false
  );
  assert.equal(
    await inspectLinuxPrefixProcesses(
      "/prefix",
      processInspectionPort({ denied: "EPERM" }) as never
    ),
    false
  );
  assert.equal(
    await inspectLinuxPrefixProcesses(
      "/alias",
      processInspectionPort({ environment: "WINEPREFIX=/prefix\0" }) as never
    ),
    true
  );
  assert.equal(
    await inspectLinuxPrefixProcesses(
      "/prefix",
      processInspectionPort({ environment: "WINEPREFIX=/alias\0" }) as never
    ),
    true
  );
  const inaccessibleForeignPath = processInspectionPort({
    environment: "WINEPREFIX=/other\0",
  });
  inaccessibleForeignPath.realpath = async (value: string) => {
    if (value === "/other")
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    return value;
  };
  assert.equal(
    await inspectLinuxPrefixProcesses(
      "/prefix",
      inaccessibleForeignPath as never
    ),
    false
  );
});
