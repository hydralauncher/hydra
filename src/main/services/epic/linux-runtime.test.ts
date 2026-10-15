import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import { createHash } from "node:crypto";
import test, { type TestContext } from "node:test";
import ts from "typescript";
import * as protocol from "./linux-runtime-protocol.js";
import * as constants from "./linux-runtime-constants.js";
import { observeEpicLinuxLaunch } from "./linux-launch-monitor.js";
import type { PreparedEpicLinuxContext } from "./linux-runtime";
import type { UmuProcessHandle } from "../umu-supervised-process";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function fixture(t: TestContext) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "epic-linux-runtime-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const proton = path.join(root, "Proton with spaces");
  const umu = path.join(root, "umu-run");
  const install = path.join(root, "Game with spaces");
  const helper = path.join(root, "epic", "epic-prerequisite-runner.exe");
  await Promise.all([
    fsp.mkdir(proton),
    fsp.mkdir(install),
    fsp.mkdir(path.dirname(helper)),
  ]);
  await Promise.all([
    fsp.writeFile(path.join(proton, "proton"), "proton fixture"),
    fsp.writeFile(path.join(proton, "toolmanifest.vdf"), "manifest fixture"),
    fsp.writeFile(umu, "umu fixture"),
    fsp.writeFile(helper, "helper fixture"),
    fsp.writeFile(path.join(install, "Redist.exe"), "installer fixture"),
    fsp.writeFile(path.join(install, "Package.msi"), "msi fixture"),
  ]);
  const state = {
    ready: false,
    occupied: false,
    calls: [] as Array<{
      args: string[];
      environment: Record<string, string>;
      cwd: string;
    }>,
    terminated: 0,
    code: 0,
    launchCode: 0,
    launchExit: null as Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }> | null,
    terminateWait: Promise.resolve() as Promise<void>,
    terminateFails: false,
    treeExit: null as ((signal?: AbortSignal) => Promise<void>) | null,
    beforePython: null as (() => Promise<void>) | null,
    beforeSpawn: null as ((args: string[]) => Promise<void>) | null,
    rebootCode: 0,
    requests: [] as Array<{ kind: string; executable: string; args: string[] }>,
    umuVersion: "1.4.4",
    nonceWrong: false,
    configured: null as {
      defaultProtonPath?: string;
      defaultWinePrefixPath?: string;
    } | null,
  };
  class ManagedError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  const modules: Record<string, unknown> = {
    "node:fs/promises": {
      ...fsp,
      realpath: async (value: string) =>
        value === "/fixture/proton" ? proton : fsp.realpath(value),
    },
    electron: { app: { isPackaged: true } },
    "@main/level": {
      db: { get: async () => state.configured },
      levelKeys: { userPreferences: "preferences" },
    },
    "@main/helpers/resolve-launch-command": {
      resolveLaunchCommand: ({
        baseCommand,
        baseArgs,
      }: {
        baseCommand: string;
        baseArgs: string[];
      }) => ({ command: baseCommand, args: baseArgs, env: {} }),
    },
    "@main/events/helpers/parse-launch-options": {
      parseLaunchOptions: (input?: string) => input?.split(" ") ?? [],
    },
    "../system-path": { SystemPath: { getPath: () => root } },
    "../wine": {
      Wine: {
        getDefaultPrefixPath: () => path.join(root, "prefixes"),
        resolvePrefixPath: async (value: string) => path.resolve(value),
        isPrefixReadyForRestore: () => state.ready,
      },
    },
    "../legendary-runtime-paths": {
      getLegendaryLinuxPythonRunnerPath: async () => {
        await state.beforePython?.();
        return "/private/python-runner";
      },
    },
    "../umu-supervised-process": {
      hasLinuxPrefixProcesses: async () => state.occupied,
    },
    "../umu": {
      Umu: {
        isValidProtonPath: (value: string) =>
          fs.existsSync(path.join(value, "proton")),
        getSupervisedBinaryPath: () => umu,
        getSupervisedRuntime: () => ({
          binaryPath: umu,
          version: state.umuVersion,
          sha256: createHash("sha256").update("umu fixture").digest("hex"),
        }),
        launchSupervised: async (options: {
          args: string[];
          environment: Record<string, string>;
          cwd: string;
          onLine?: (line: string) => void;
          signal?: AbortSignal;
        }) => {
          await state.beforeSpawn?.(options.args);
          state.calls.push(options);
          const command = options.args[1];
          let stdout = "";
          if (command === helper && options.args[2] === "--probe") {
            state.ready = true;
            options.onLine?.("DEBUG: PROTONPATH=/fixture/proton");
          } else if (
            options.environment.PROTON_VERB === "getcompatpath" ||
            options.environment.PROTON_VERB === "getnativepath"
          )
            stdout = command;
          else if (command === helper) {
            const nativePath = (value: string) =>
              process.platform === "win32"
                ? value
                : value.replace(/\\/g, path.sep);
            const request = JSON.parse(
              await fsp.readFile(nativePath(options.args[2]), "utf8")
            );
            state.requests.push(request);
            await fsp.writeFile(
              nativePath(request.resultPath),
              JSON.stringify({
                schemaVersion: 1,
                nonce: state.nonceWrong ? "wrong" : request.nonce,
                exitCode:
                  request.kind === "reboot" ? state.rebootCode : state.code,
              })
            );
          }
          return {
            pid: 123,
            invocationId: "invocation",
            exited:
              state.launchExit ??
              Promise.resolve({ code: state.launchCode, signal: null }),
            output: Promise.resolve({ stdout, stderr: "" }),
            terminate: async () => {
              state.terminated++;
              await state.terminateWait;
              if (state.terminateFails)
                throw new ManagedError("cleanup-failed");
            },
            waitForTreeExit: async () => state.treeExit?.(options.signal),
          };
        },
      },
    },
    "./legendary-managed-runtime": {
      EpicManagedError: ManagedError,
      managedWorkspacePath: (_data: string, owner: unknown, artifact: string) =>
        path.join(
          root,
          "workspace",
          protocol.epicLinuxDigest([owner, artifact])
        ),
    },
    "./windows-path": {
      resolveEpicWindowsPath: async (base: string, relative: string) =>
        path.join(base, relative),
    },
    "./constants": { EPIC_PREREQUISITE_TIMEOUT_MS: 300_000 },
    "./linux-runtime-constants": constants,
    "./linux-launch-monitor.js": { observeEpicLinuxLaunch },
    "./linux-runtime-protocol": {
      ...protocol,
      parseEpicLinuxMappedPath: (output: string) => output,
    },
    "../../../shared/epic-linux-runtime-manifest.json": {
      umu: { sha256: createHash("sha256").update("umu fixture").digest("hex") },
    },
    "../../../shared/epic-umu-map.json": {
      entries: { artifact: "umu-fixture" },
    },
  };
  const source = await fsp.readFile(
    new URL("./linux-runtime.ts", import.meta.url),
    "utf8"
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const exported: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  vm.runInNewContext(compiled, {
    exports: exported,
    require: (name: string) => {
      if (name in modules) return modules[name];
      // Only Node core, crypto and string-argv may escape the fixture ports.
      if (name.startsWith("node:")) return requireCore(name);
      if (name === "string-argv")
        return {
          __esModule: true,
          default: (value: string) => (value ? [value] : []),
        };
      throw new Error(`Unexpected dependency ${name}`);
    },
    process: {
      ...process,
      platform: "linux",
      arch: "x64",
      resourcesPath: root,
    },
    Buffer,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  const owner = {
    environment: "production",
    userId: "user",
    epicAccountId: "account",
  };
  const target = { owner, artifactId: "Artifact", platform: "Windows" };
  const game = {
    objectId: "Namespace:Item",
    shop: "epic",
    epicInstallation: { owner, artifactId: "Artifact" },
  };
  const installed = {
    installPath: install,
    version: "build",
    prereq_info: { path: "Redist.exe", args: "/quiet" },
  };
  const options = () => ({
    signal: new AbortController().signal,
    installPath: install,
  });
  return {
    root,
    state,
    api: exported,
    target,
    game,
    installed,
    options,
    proton,
  };
}
import { createRequire } from "node:module";
const requireCore = createRequire(import.meta.url);

test("automatic runtime bootstraps explicitly with private Python and pins the effective path", async (t) => {
  const f = await fixture(t);
  const context = (await f.api.prepareEpicLinuxRuntime(
    f.game,
    f.target,
    f.options()
  )) as { protonPath: string; prefixGeneration: string; gameId: string };
  assert.equal(f.state.calls[0].environment.PROTONPATH, "UMU-Proton");
  assert.equal(f.state.calls[0].environment.UMU_ZENITY, "");
  assert.equal(f.state.calls[0].args[2], "--probe");
  assert.equal(context.protonPath, f.proton);
  assert.match(context.prefixGeneration, /^[a-f0-9-]{36}$/);
  assert.equal(context.gameId, "umu-fixture");
  assert.equal(f.state.terminated, 0);
});

test("offline requires a verified receipt and starts no release bootstrap", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.api.prepareEpicLinuxRuntime(f.game, f.target, {
      ...f.options(),
      offline: true,
    }),
    { code: "compatibility-runtime-unavailable" }
  );
  const input = {
    game: f.game,
    target: f.target,
    installed: { ...f.installed, prereq_info: undefined },
    ...f.options(),
  };
  await f.api.ensureEpicLinuxPrerequisites(input);
  const calls = f.state.calls.length;
  const context = (await f.api.ensureEpicLinuxPrerequisites({
    ...input,
    offline: true,
  })) as { protonPath: string; offline: boolean };
  assert.equal(context.protonPath, f.proton);
  assert.equal(context.offline, true);
  assert.equal(f.state.calls.length, calls);
  await fsp.writeFile(path.join(f.proton, "proton"), "changed runtime");
  await assert.rejects(
    f.api.ensureEpicLinuxPrerequisites({
      ...input,
      offline: true,
    }),
    { code: "compatibility-runtime-unavailable" }
  );
});

test("offline receipt binds the artifact build and validated UMU version", async (t) => {
  const f = await fixture(t);
  const input = {
    game: f.game,
    target: f.target,
    installed: { ...f.installed, prereq_info: undefined },
    ...f.options(),
  };
  await f.api.ensureEpicLinuxPrerequisites(input);
  await assert.rejects(
    f.api.ensureEpicLinuxPrerequisites({
      ...input,
      installed: { ...input.installed, version: "new-build" },
      offline: true,
    }),
    { code: "compatibility-runtime-unavailable" }
  );
  f.state.umuVersion = "1.4.5";
  await assert.rejects(
    f.api.ensureEpicLinuxPrerequisites({ ...input, offline: true }),
    { code: "compatibility-runtime-unavailable" }
  );
});

test("cached preparation for tools validates the explicit build without bootstrap", async (t) => {
  const f = await fixture(t);
  await f.api.ensureEpicLinuxPrerequisites({
    game: f.game,
    target: f.target,
    installed: { ...f.installed, prereq_info: undefined },
    ...f.options(),
  });
  const calls = f.state.calls.length;
  await f.api.prepareEpicLinuxRuntime(f.game, f.target, {
    ...f.options(),
    offline: true,
    buildVersion: f.installed.version,
  });
  assert.equal(f.state.calls.length, calls);
});

test("every path mapping verb keeps the canonical installation context and offline rejects a moved installation", async (t) => {
  const f = await fixture(t);
  const input = {
    game: f.game,
    target: f.target,
    installed: { ...f.installed, prereq_info: undefined },
    ...f.options(),
  };
  const context = await f.api.ensureEpicLinuxPrerequisites(input);
  const before = f.state.calls.length;
  await f.api.mapEpicLinuxPath(
    context,
    path.join(f.installed.installPath, "Redist.exe")
  );
  const calls = f.state.calls.slice(before);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].environment.PROTON_VERB, "getcompatpath");
  assert.equal(calls[1].environment.PROTON_VERB, "getnativepath");
  for (const call of calls)
    assert.equal(
      call.environment.STEAM_COMPAT_INSTALL_PATH,
      f.installed.installPath
    );
  const moved = path.join(f.root, "moved install");
  await fsp.mkdir(moved);
  await assert.rejects(
    f.api.ensureEpicLinuxPrerequisites({
      ...input,
      installed: { ...input.installed, installPath: moved },
      offline: true,
    }),
    { code: "compatibility-runtime-unavailable" }
  );
  await assert.rejects(
    f.api.prepareEpicLinuxRuntime(f.game, f.target, {
      signal: new AbortController().signal,
    }),
    { code: "invalid-path" }
  );
});

test("installer receipt accepts full Windows reboot codes and avoids repeating a completed prerequisite", async (t) => {
  const f = await fixture(t);
  f.state.code = 3010;
  const input = {
    game: f.game,
    target: f.target,
    installed: f.installed,
    ...f.options(),
  };
  await f.api.ensureEpicLinuxPrerequisites(input);
  assert.equal(
    f.state.calls.filter(
      (call) =>
        call.args[1].endsWith("epic-prerequisite-runner.exe") &&
        call.args[2] !== "--probe"
    ).length,
    2
  );
  assert.equal(f.state.requests[1].kind, "reboot");
  assert.equal(f.state.requests[1].executable, "");
  assert.deepEqual(Array.from(f.state.requests[1].args), []);
  await f.api.ensureEpicLinuxPrerequisites(input);
  assert.equal(
    f.state.calls.filter(
      (call) =>
        call.args[1].endsWith("epic-prerequisite-runner.exe") &&
        call.args[2] !== "--probe"
    ).length,
    2
  );
});

test("failed supervised reboot never writes a completed prerequisite receipt", async (t) => {
  const f = await fixture(t);
  f.state.code = 3010;
  f.state.rebootCode = 1;
  const input = {
    game: f.game,
    target: f.target,
    installed: f.installed,
    ...f.options(),
  };
  await assert.rejects(f.api.ensureEpicLinuxPrerequisites(input), {
    code: "prerequisites-required",
  });
  f.state.rebootCode = 0;
  await f.api.ensureEpicLinuxPrerequisites(input);
  assert.equal(
    f.state.requests.filter((request) => request.kind === "exe").length,
    2
  );
});

test("truncated POSIX-looking results and forged nonces never complete a prerequisite", async (t) => {
  const f = await fixture(t);
  for (const code of [194, 105]) {
    f.state.code = code;
    await assert.rejects(
      f.api.ensureEpicLinuxPrerequisites({
        game: f.game,
        target: f.target,
        installed: f.installed,
        ...f.options(),
      }),
      { code: "prerequisites-required" }
    );
  }
  f.state.code = 0;
  f.state.nonceWrong = true;
  await assert.rejects(
    f.api.ensureEpicLinuxPrerequisites({
      game: f.game,
      target: f.target,
      installed: f.installed,
      ...f.options(),
    }),
    { code: "prerequisites-required" }
  );
});

for (const interruption of ["cancel", "timeout"] as const) {
  test(`bootstrap ${interruption} reports and retains failed cleanup while its wrapper stays alive`, async (t) => {
    const f = await fixture(t);
    const controller = new AbortController();
    const entered = gate();
    f.state.launchExit = new Promise(() => {});
    f.state.terminateFails = true;
    f.state.treeExit = (signal) => {
      entered.open();
      if (interruption === "timeout")
        return Promise.reject(
          Object.assign(new Error("timeout"), { code: "timeout" })
        );
      return new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () =>
            reject(
              Object.assign(new Error("cancelled"), {
                code: "operation-cancelled",
              })
            ),
          { once: true }
        );
      });
    };
    const preparing = f.api.prepareEpicLinuxRuntime(f.game, f.target, {
      ...f.options(),
      signal: controller.signal,
    });
    const rejected = assert.rejects(preparing, { code: "cleanup-failed" });
    await entered.promise;
    if (interruption === "cancel") controller.abort();
    await rejected;
    const prefix = f.state.calls[0].environment.WINEPREFIX;
    let mutated = false;
    await assert.rejects(
      f.api.withEpicLinuxPrefixMutation(prefix, async () => {
        mutated = true;
      }),
      { code: "cleanup-failed" }
    );
    assert.equal(mutated, false);
    await assert.rejects(f.api.retryEpicLinuxCleanup(), {
      code: "cleanup-failed",
    });
    f.state.terminateFails = false;
    await f.api.retryEpicLinuxCleanup();
    await f.api.withEpicLinuxPrefixMutation(prefix, async () => {
      mutated = true;
    });
    assert.equal(mutated, true);
  });
}

test("shared-prefix leases and save mutations wait for bootstrap and prerequisites", async (t) => {
  for (const phase of ["bootstrap", "prerequisite"] as const) {
    const f = await fixture(t);
    const context = (await f.api.prepareEpicLinuxRuntime(
      f.game,
      f.target,
      f.options()
    )) as PreparedEpicLinuxContext;
    const entered = gate(),
      resume = gate();
    const pause = async () => {
      entered.open();
      await resume.promise;
    };
    if (phase === "bootstrap") f.state.beforePython = pause;
    else
      f.state.beforeSpawn = async (args) => {
        if (
          args[1] ===
            path.join(f.root, "epic", "epic-prerequisite-runner.exe") &&
          args[2] !== "--probe"
        )
          await pause();
      };
    const game = {
      ...f.game,
      objectId: "Namespace:Other",
      winePrefixPath: context.winePrefixPath,
    };
    const target = { ...f.target, artifactId: "Other" };
    const preparing =
      phase === "bootstrap"
        ? f.api.prepareEpicLinuxRuntime(game, target, f.options())
        : f.api.ensureEpicLinuxPrerequisites({
            game,
            target,
            installed: f.installed,
            ...f.options(),
          });
    await entered.promise;
    let acquired = false,
      mutated = false;
    const acquiring = f.api
      .acquireEpicLinuxPrefixSession(context)
      .then((lease) => {
        acquired = true;
        return lease as { release(): void };
      });
    const mutation = assert.rejects(
      f.api.withEpicLinuxPrefixMutation(context.winePrefixPath, async () => {
        mutated = true;
      }),
      { code: "compatibility-prefix-busy" }
    );
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(acquired, false, phase);
      assert.equal(mutated, false, phase);
    } finally {
      resume.open();
      await preparing;
      const lease = await acquiring;
      await mutation;
      lease.release();
    }
  }
});

test("a cancelled queued lease cannot reserve the prefix after preparation finishes", async (t) => {
  const f = await fixture(t);
  const context = (await f.api.prepareEpicLinuxRuntime(
    f.game,
    f.target,
    f.options()
  )) as PreparedEpicLinuxContext;
  const entered = gate(),
    resume = gate();
  const mutation = f.api.withEpicLinuxPrefixMutation(
    context.winePrefixPath,
    async () => {
      entered.open();
      await resume.promise;
    }
  );
  await entered.promise;
  const controller = new AbortController();
  const cancelled = assert.rejects(
    f.api.acquireEpicLinuxPrefixSession(context, controller.signal),
    { code: "operation-cancelled" }
  );
  controller.abort();
  await cancelled;
  resume.open();
  await mutation;
  const lease = (await f.api.acquireEpicLinuxPrefixSession(context)) as {
    release(): void;
  };
  lease.release();
});

test("startup cancellation awaits termination and retains a failed handle for cleanup retries", async (t) => {
  for (const cleanupFails of [false, true]) {
    const f = await fixture(t);
    const context = await f.api.prepareEpicLinuxRuntime(
      f.game,
      f.target,
      f.options()
    );
    const lease = (await f.api.acquireEpicLinuxPrefixSession(context)) as {
      release(): void;
    };
    const spawned = gate(),
      terminated = gate();
    f.state.launchExit = new Promise(() => {});
    f.state.terminateWait = terminated.promise;
    f.state.terminateFails = cleanupFails;
    const controller = new AbortController();
    let captured: UmuProcessHandle | undefined,
      settled = false;
    const launching = f.api
      .launchEpicLinuxGame(
        {
          executable: "Game.exe",
          args: [],
          workingDirectory: f.root,
          environment: {},
        },
        context,
        {
          lease,
          signal: controller.signal,
          onSpawn: (handle: UmuProcessHandle) => {
            captured = handle;
            spawned.open();
          },
        }
      )
      .finally(() => {
        settled = true;
      });
    const rejected = assert.rejects(launching, {
      code: cleanupFails ? "cleanup-failed" : "operation-cancelled",
    });
    await spawned.promise;
    controller.abort();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(f.state.terminated, 1);
    assert.equal(settled, false);
    await assert.rejects(f.api.acquireEpicLinuxPrefixSession(context), {
      code: "compatibility-prefix-busy",
    });
    terminated.open();
    await rejected;
    assert.ok(captured);
    if (cleanupFails) {
      f.state.terminateFails = false;
      await captured.terminate();
      assert.equal(f.state.terminated, 2);
    }
    lease.release();
  }
});

test("session lease reserves a custom prefix across restore/spawn and blocks other mutations", async (t) => {
  const f = await fixture(t);
  const context = await f.api.prepareEpicLinuxRuntime(
    f.game,
    f.target,
    f.options()
  );
  const lease = (await f.api.acquireEpicLinuxPrefixSession(context)) as {
    release(): void;
  };
  await assert.rejects(f.api.acquireEpicLinuxPrefixSession(context), {
    code: "compatibility-prefix-busy",
  });
  await assert.rejects(
    f.api.prepareEpicLinuxRuntime(f.game, f.target, f.options()),
    { code: "compatibility-prefix-busy" }
  );
  lease.release();
  const next = (await f.api.acquireEpicLinuxPrefixSession(context)) as {
    release(): void;
  };
  next.release();
});

test("a failed wrapper reports launch failure while retaining the caller's prefix lease", async (t) => {
  const f = await fixture(t);
  const context = await f.api.prepareEpicLinuxRuntime(
    f.game,
    f.target,
    f.options()
  );
  const lease = (await f.api.acquireEpicLinuxPrefixSession(context)) as {
    release(): void;
  };
  const statuses: unknown[] = [];
  f.state.launchCode = 37;
  await assert.rejects(
    f.api.launchEpicLinuxGame(
      {
        executable: "Game.exe",
        args: [],
        workingDirectory: f.root,
        environment: {},
      },
      context,
      { lease, onStatus: (status: unknown) => statuses.push(status) }
    ),
    { code: "compatibility-launch-failed" }
  );
  assert.deepEqual(JSON.parse(JSON.stringify(statuses)), [
    { type: "failed", message: "compatibility-launch-failed" },
  ]);
  await assert.rejects(f.api.acquireEpicLinuxPrefixSession(context), {
    code: "compatibility-prefix-busy",
  });
  lease.release();
});

test("a failed launch never releases the caller's prefix lease before token cleanup", async (t) => {
  const f = await fixture(t);
  const context = await f.api.prepareEpicLinuxRuntime(
    f.game,
    f.target,
    f.options()
  );
  const lease = (await f.api.acquireEpicLinuxPrefixSession(context)) as {
    release(): void;
  };
  await fsp.writeFile(path.join(f.proton, "proton"), "changed runtime");
  await assert.rejects(
    f.api.launchEpicLinuxGame(
      {
        executable: "Game.exe",
        args: [],
        workingDirectory: f.root,
        environment: {},
      },
      context,
      { lease }
    ),
    { code: "compatibility-launch-failed" }
  );
  await assert.rejects(f.api.acquireEpicLinuxPrefixSession(context), {
    code: "compatibility-prefix-busy",
  });
  lease.release();
});

test("cancellation or lease replacement during fingerprint IO prevents spawning", async (t) => {
  const f = await fixture(t);
  const context = await f.api.prepareEpicLinuxRuntime(
    f.game,
    f.target,
    f.options()
  );
  const parameters = {
    executable: "Game.exe",
    args: [],
    workingDirectory: f.root,
    environment: {},
  };
  const lease = (await f.api.acquireEpicLinuxPrefixSession(context)) as {
    release(): void;
  };
  const controller = new AbortController();
  const calls = f.state.calls.length;
  const cancelled = f.api.launchEpicLinuxGame(parameters, context, {
    lease,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(cancelled, { code: "operation-cancelled" });
  assert.equal(f.state.calls.length, calls);
  lease.release();
  const oldLease = (await f.api.acquireEpicLinuxPrefixSession(context)) as {
    release(): void;
  };
  const revoked = f.api.launchEpicLinuxGame(parameters, context, {
    lease: oldLease,
  });
  oldLease.release();
  const replacement = (await f.api.acquireEpicLinuxPrefixSession(context)) as {
    release(): void;
  };
  await assert.rejects(revoked, { code: "compatibility-launch-failed" });
  assert.equal(f.state.calls.length, calls);
  await assert.rejects(f.api.acquireEpicLinuxPrefixSession(context), {
    code: "compatibility-prefix-busy",
  });
  replacement.release();
});
