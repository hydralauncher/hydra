import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test, { type TestContext } from "node:test";
import ts from "typescript";
import * as protocol from "./launch-protocol.js";
import { EpicSaveFailure } from "./cloud-save-protocol.js";
import { EpicManagedProcessTracker } from "./managed-process-tracker.js";
import { isPathInside } from "./session-attribution.js";
import type { Game } from "@types";
import * as ownershipToken from "./ownership-token.js";
import * as windowsPath from "./windows-path.js";

async function fixture(t: TestContext, options: { linux?: boolean } = {}) {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), "epic-launch-session-")
  );
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "Game with spaces.exe");
  const child = path.join(root, "Game child.exe");
  await Promise.all([
    fsp.writeFile(executable, "fixture"),
    fsp.writeFile(child, "fixture"),
  ]);
  const state = {
    current: true,
    authCalls: 0,
    offlineCalls: 0,
    localCaptures: 0,
    closes: 0,
    starts: 0,
    conflict: false,
    canRunOffline: true,
    reportsStarted: 0,
    reportsObserved: 0,
    reportsInterrupted: 0,
    reportsFinished: 0,
    reportsDiscarded: 0,
    order: [] as string[],
    capturePrefixes: [] as unknown[],
    tokenRequired: [] as boolean[],
    leaseReleases: 0,
    tokenDisposals: 0,
    tokenDisposeAttempts: 0,
    tokenDisposeFailures: 0,
    tokenDisposeWait: Promise.resolve() as Promise<void>,
    terminations: 0,
    cleanupFails: false,
    pendingPreparationCleanup: false,
    preparationCleanupRetries: 0,
    uploadWait: Promise.resolve() as Promise<void>,
    terminateWait: Promise.resolve() as Promise<void>,
    prepareWait: null as ((signal: AbortSignal) => Promise<void>) | null,
    launchWait: null as ((signal?: AbortSignal) => Promise<void>) | null,
    observeWait: null as ((signal?: AbortSignal) => Promise<void>) | null,
    launchCalls: 0,
    launchSignals: [] as Array<AbortSignal | undefined>,
  };
  const session = {
    objectId: "Namespace:Item",
    target: { owner: { userId: "captured" }, artifactId: "Artifact" },
    installed: {
      executablePath: executable,
      installPath: root,
      can_run_offline: true,
      requires_ot: false,
    },
  };
  const cloud = {
    capture: async (
      _objectId: string,
      _signal: AbortSignal,
      _prefix: unknown,
      localOnly: boolean
    ) => {
      if (localOnly) state.localCaptures++;
      state.capturePrefixes.push(_prefix);
      state.order.push("capture");
      session.installed.can_run_offline = state.canRunOffline;
      return session;
    },
    beforeLaunch: async () => {
      state.order.push("restore");
      if (state.conflict) throw new EpicSaveFailure("save-conflict");
    },
    markSessionStarted: async () => {
      state.starts++;
    },
    assertSessionCurrent: () => {
      if (!state.current) throw new EpicSaveFailure("operation-cancelled");
    },
    afterClose: async () => {
      state.closes++;
      state.order.push("upload");
      await state.uploadWait;
    },
    endSession: () => {},
  };
  const result = () => ({
    launch_command: [],
    game_directory: root,
    game_executable: path.basename(executable),
    working_directory: root,
    game_parameters: ["-AUTH_PASSWORD=private code"],
    user_parameters: [],
    egl_parameters: [],
    environment: {},
  });
  const modules: Record<string, unknown> = {
    "node:fs/promises": fsp,
    "node:path": path,
    "@main/level": {
      levelKeys: {
        game: (shop: string, objectId: string) => `${shop}:${objectId}`,
      },
    },
    "../logger": { logger: { warn: () => {}, info: () => {} } },
    "./cloud-saves": { getEpicCloudSaveService: () => cloud },
    "./cloud-save-protocol.js": { EpicSaveFailure },
    "./launch-protocol.js": protocol,
    "./constants.js": { EPIC_LAUNCH_DETECTION_TIMEOUT_MS: 1000 },
    "./managed-process-tracker.js": { EpicManagedProcessTracker },
    "./session-attribution.js": { isPathInside },
    "./ownership-token.js": options.linux
      ? {
          prepareEpicOwnershipToken: async (
            _workspace: string,
            _objectId: string,
            required: boolean,
            map: (directory: string) => Promise<string>
          ) => {
            state.tokenRequired.push(required);
            state.order.push("token-reserve");
            if (required) await map(root);
            return {
              translate: async (parameters: protocol.EpicLaunchParameters) => {
                if (
                  required &&
                  !parameters.args.some((value) =>
                    value.startsWith("-epicovt=")
                  )
                )
                  throw new EpicSaveFailure("invalid-response");
                state.order.push("token-translate");
                return parameters;
              },
              dispose: async () => {
                state.tokenDisposeAttempts++;
                await state.tokenDisposeWait;
                if (state.tokenDisposeFailures > 0) {
                  state.tokenDisposeFailures--;
                  throw new Error("transient token cleanup failure");
                }
                state.tokenDisposals++;
                state.order.push("token-dispose");
              },
            };
          },
        }
      : ownershipToken,
    "./windows-path.js": windowsPath,
    "./linux-runtime": {
      retryEpicLinuxCleanup: async () => {
        if (!state.pendingPreparationCleanup) return;
        state.preparationCleanupRetries++;
        if (state.cleanupFails) throw new EpicSaveFailure("cleanup-failed");
        state.pendingPreparationCleanup = false;
      },
      ensureEpicLinuxPrerequisites: async (input: { signal: AbortSignal }) => {
        state.order.push("prepare");
        await state.prepareWait?.(input.signal);
        return {
          winePrefixPath: path.join(root, "prepared-prefix"),
          installPath: path.dirname(executable),
        };
      },
      acquireEpicLinuxPrefixSession: async () => {
        state.order.push("lease");
        return {
          id: "prefix-lease",
          release: () => {
            state.leaseReleases++;
            state.order.push("lease-release");
          },
        };
      },
      mapEpicLinuxPath: async () => {
        state.order.push("token-map");
        return "Q:\\Private";
      },
      launchEpicLinuxGame: async (
        _parameters: protocol.EpicLaunchParameters,
        _context: unknown,
        options: { signal?: AbortSignal; onSpawn?: (handle: unknown) => void }
      ) => {
        if (options.signal?.aborted)
          throw new EpicSaveFailure("operation-cancelled");
        state.launchCalls++;
        state.launchSignals.push(options.signal);
        state.order.push("spawn-start");
        await state.launchWait?.(options.signal);
        // Native spawn may already have crossed the cancellation boundary.
        state.order.push("spawn-handle");
        options.onSpawn?.(handle);
        try {
          await state.observeWait?.(options.signal);
        } catch (error) {
          await handle.terminate();
          throw error;
        }
        return handle;
      },
    },
  };
  const exported = {} as typeof import("./launch");
  const compiled = ts.transpileModule(
    fs.readFileSync(new URL("./launch.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText;
  vm.runInNewContext(
    compiled,
    {
      exports: exported,
      require: (name: string) => {
        assert.ok(name in modules, `Unexpected import ${name}`);
        return modules[name];
      },
      setTimeout,
      clearTimeout,
      AbortController,
      process: { platform: options.linux ? "linux" : "win32" },
    },
    { filename: "launch.ts" }
  );
  t.after(() => exported.clearManagedEpicSessions());
  exported.configureEpicLaunch({
    playtime: {
      begin: (_objectId: string, target: unknown) => {
        state.reportsStarted++;
        assert.equal(target, session.target);
        return {};
      },
      observe: () => {
        state.reportsObserved++;
      },
      interrupt: () => {
        state.reportsInterrupted++;
      },
      interruptAll: () => {
        state.reportsInterrupted++;
      },
      finish: () => {
        state.reportsFinished++;
      },
      discard: () => {
        state.reportsDiscarded++;
      },
    },
    runtime: {
      current: () => state.current,
      assertCurrent: () => {
        if (!state.current) throw new EpicSaveFailure("operation-cancelled");
      },
      runJson: async () => {
        state.authCalls++;
        state.order.push("auth");
        return session.installed.requires_ot
          ? { ...result(), egl_parameters: ["-epicovt=/private/token.ovt"] }
          : result();
      },
      runOfflineLaunch: async () => {
        state.offlineCalls++;
        state.order.push("offline-auth");
        return { ...result(), game_parameters: ["-AUTH_TYPE=offline"] };
      },
      workspace: () => root,
    },
  } as never);
  const game = { shop: "epic", objectId: "Namespace:Item" } as Game;
  const handle = {
    pid: 100,
    invocationId: "invocation",
    rootStartTime: "10",
    exited: Promise.resolve({ code: 0, signal: null }),
    output: Promise.resolve({ stdout: "", stderr: "" }),
    waitForTreeExit: async () => undefined,
    terminate: async () => {
      state.terminations++;
      await state.terminateWait;
      if (state.cleanupFails) throw new EpicSaveFailure("cleanup-failed");
    },
  };
  const linuxContext = {
    invocationId: handle.invocationId,
    winePrefixPath: path.join(root, "prepared-prefix"),
    rootStartTime: handle.rootStartTime,
  };
  const linuxGameProcess = {
    pid: 101,
    parentPid: 100,
    exe: process.execPath,
    peExecutablePath: executable,
    startTime: "11",
    inspectionComplete: true,
    invocationId: handle.invocationId,
    winePrefixPath: linuxContext.winePrefixPath,
  };
  return {
    exported,
    state,
    session,
    executable,
    child,
    game,
    handle,
    linuxContext,
    linuxGameProcess,
  };
}

test("Legendary JSON exit does not close the game; actual bootstrapper/child closes upload once", async (t) => {
  const f = await fixture(t);
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  assert.equal(prepared.parameters.args[0], "-AUTH_PASSWORD=private code");
  await f.exported.markManagedEpicLaunched(prepared.session);
  f.exported.recordManagedEpicProcess(prepared.session, 100);
  await assert.rejects(
    f.exported.prepareManagedEpicLaunch(f.game, f.executable),
    /game-running/
  );
  assert.equal(f.exported.onManagedEpicClosed(f.game), false);
  assert.equal(f.state.closes, 0);
  assert.equal(f.state.reportsStarted, 0);
  const running = await f.exported.getManagedEpicProcessMatch(
    "epic:Namespace:Item",
    [{ pid: 101, parentPid: 100, exe: f.child }]
  );
  assert.equal(running.path, f.child);
  assert.equal(await f.exported.onManagedEpicDetected(f.game, f.child), true);
  assert.equal(await f.exported.onManagedEpicDetected(f.game, f.child), true);
  assert.equal(f.state.reportsStarted, 1);
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", [
    { pid: 101, parentPid: 100, exe: f.child },
  ]);
  assert.equal(f.state.reportsObserved, 1);
  assert.equal(
    (
      await f.exported.getManagedEpicProcessMatch(
        "epic:Namespace:Item",
        undefined
      )
    ).complete,
    false
  );
  assert.equal(
    (await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", []))
      .path,
    null
  );
  assert.equal(f.exported.onManagedEpicClosed(f.game), true);
  assert.equal(f.exported.onManagedEpicClosed(f.game), true);
  assert.equal(f.state.closes, 1);
  assert.equal(f.state.reportsFinished, 1);
  assert.equal(f.state.reportsInterrupted, 2);
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(f.exported.onManagedEpicClosed(f.game), false);
});

test("official sessions, failed launches and context changes cannot start or finish managed playtime", async (t) => {
  const f = await fixture(t);
  assert.equal(
    await f.exported.onManagedEpicDetected(f.game, f.executable),
    false
  );
  assert.equal(f.exported.onManagedEpicClosed(f.game), false);
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  await f.exported.cancelManagedEpicLaunch(prepared.session);
  assert.equal(f.state.reportsStarted, 0);
  await f.exported.markManagedEpicLaunched(prepared.session);
  f.state.current = false;
  assert.equal(
    await f.exported.onManagedEpicDetected(f.game, f.executable),
    false
  );
  assert.equal(f.state.reportsStarted, 0);
  f.state.current = true;
  f.exported.recordManagedEpicProcess(prepared.session, 100);
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", [
    { pid: 101, parentPid: 100, exe: f.executable },
  ]);
  assert.equal(
    await f.exported.onManagedEpicDetected(f.game, f.executable),
    true
  );
  await f.exported.clearManagedEpicSessions();
  assert.equal(f.state.reportsDiscarded, 1);
  assert.equal(f.exported.onManagedEpicClosed(f.game), false);
  assert.equal(f.state.reportsFinished, 0);
});

test("an external Epic overlay cannot suppress verified game playtime or count time by itself", async (t) => {
  const f = await fixture(t);
  const overlay = `${path.dirname(f.executable)}-overlay.exe`;
  await fsp.writeFile(overlay, "fixture");
  t.after(() => fsp.rm(overlay, { force: true }));
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  f.exported.recordManagedEpicProcess(prepared.session, 100);
  const processes = [
    { pid: 101, parentPid: 100, exe: f.child },
    { pid: 102, parentPid: 101, exe: overlay },
  ];
  const match = await f.exported.getManagedEpicProcessMatch(
    "epic:Namespace:Item",
    processes
  );
  assert.equal(match.complete, false);
  assert.equal(match.path, f.child);
  assert.equal(await f.exported.onManagedEpicDetected(f.game, f.child), true);
  assert.equal(f.state.reportsStarted, 1);
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", processes);
  assert.equal(f.state.reportsObserved, 1);
  const overlayOnly = await f.exported.getManagedEpicProcessMatch(
    "epic:Namespace:Item",
    [processes[1]]
  );
  assert.equal(overlayOnly.path, null);
  assert.equal(overlayOnly.complete, false);
  assert.equal(f.state.reportsInterrupted, 1);
  assert.equal(f.state.reportsObserved, 1);
  const closed = await f.exported.getManagedEpicProcessMatch(
    "epic:Namespace:Item",
    []
  );
  assert.equal(closed.complete, true);
  assert.equal(f.exported.onManagedEpicClosed(f.game), true);
  assert.equal(f.state.reportsFinished, 1);
});

test("an executable match without managed PID ancestry cannot report playtime", async (t) => {
  const f = await fixture(t);
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  f.exported.recordManagedEpicProcess(prepared.session, 100);
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", [
    { pid: 500, parentPid: 400, exe: f.executable },
  ]);
  await f.exported.onManagedEpicDetected(f.game, f.executable);
  assert.equal(f.state.reportsStarted, 0);
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", [
    { pid: 101, parentPid: 100, exe: f.executable },
  ]);
  assert.equal(f.state.reportsStarted, 1);
  f.exported.onManagedEpicClosed(f.game);
  assert.equal(f.state.reportsFinished, 1);
});

test("conflict prevents auth launch; offline uses only confirmed local capture and the offline command", async (t) => {
  const f = await fixture(t);
  f.state.conflict = true;
  await assert.rejects(
    f.exported.prepareManagedEpicLaunch(f.game, f.executable),
    /save-conflict/
  );
  assert.equal(f.state.authCalls, 0);
  f.state.conflict = false;
  const offline = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable,
    { epicOffline: true }
  );
  assert.equal(offline.parameters.args[0], "-AUTH_TYPE=offline");
  assert.equal(f.state.localCaptures, 1);
  assert.equal(f.state.offlineCalls, 1);
  assert.equal(f.state.authCalls, 0);
  f.state.canRunOffline = false;
  await assert.rejects(
    f.exported.prepareManagedEpicLaunch(f.game, f.executable, {
      epicOffline: true,
    }),
    /not-installable/
  );
  assert.equal(f.state.offlineCalls, 1);
});

test("Linux prepares prerequisites and maps ownership directory before auth, restoring with the prepared prefix lease", async (t) => {
  const f = await fixture(t, { linux: true });
  f.session.installed.requires_ot = true;
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  assert.equal(
    prepared.linuxContext?.winePrefixPath,
    f.linuxContext.winePrefixPath
  );
  assert.equal(prepared.session.linuxPrefixLeaseId, "prefix-lease");
  assert.equal(f.state.capturePrefixes[1], f.linuxContext.winePrefixPath);
  const before = (first: string, second: string) =>
    assert.ok(
      f.state.order.indexOf(first) < f.state.order.indexOf(second),
      `${first} precedes ${second}`
    );
  before("prepare", "lease");
  before("lease", "restore");
  before("token-map", "auth");
  before("restore", "auth");
  before("auth", "token-translate");
  assert.equal(f.state.leaseReleases, 0);
  await f.exported.cancelManagedEpicLaunch(prepared.session);
  assert.equal(f.state.leaseReleases, 1);
  assert.equal(f.state.tokenDisposals, 1);
});

test("Linux offline ownership-token games do not require an online ownership file", async (t) => {
  const f = await fixture(t, { linux: true });
  f.session.installed.requires_ot = true;
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable,
    { epicOffline: true }
  );
  assert.deepEqual(f.state.tokenRequired, [false]);
  assert.equal(f.state.authCalls, 0);
  assert.equal(f.state.offlineCalls, 1);
  assert.ok(!f.state.order.includes("token-map"));
  await f.exported.cancelManagedEpicLaunch(prepared.session);
});

test("Linux keeps the prefix/token while wrapper has exited or inspection is unknown, then through upload completion", async (t) => {
  const f = await fixture(t, { linux: true });
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  f.exported.recordManagedEpicProcess(
    prepared.session,
    f.handle.pid,
    f.linuxContext,
    f.handle
  );
  await f.handle.exited;
  assert.equal(f.state.leaseReleases, 0);
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", [
    f.linuxGameProcess,
  ]);
  assert.equal(
    await f.exported.onManagedEpicDetected(f.game, f.executable),
    true
  );
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", undefined);
  assert.equal(f.exported.onManagedEpicClosed(f.game), false);
  assert.equal(f.state.closes, 0);
  assert.equal(f.state.leaseReleases, 0);
  let completeUpload!: () => void;
  f.state.uploadWait = new Promise<void>((done) => {
    completeUpload = done;
  });
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", []);
  assert.equal(f.exported.onManagedEpicClosed(f.game), true);
  assert.equal(f.state.closes, 1);
  assert.equal(f.state.leaseReleases, 0);
  assert.equal(
    (await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", []))
      .complete,
    true
  );
  assert.equal(f.state.leaseReleases, 0);
  completeUpload();
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(f.state.tokenDisposals, 1);
  assert.equal(f.state.leaseReleases, 1);
  assert.ok(
    f.state.order.indexOf("upload") < f.state.order.indexOf("token-dispose")
  );
});

for (const recovery of ["clear", "prepare", "watcher"] as const) {
  test(`Linux closed-session cleanup retries through ${recovery} after a transient token failure without another upload`, async (t) => {
    const f = await fixture(t, { linux: true });
    const prepared = await f.exported.prepareManagedEpicLaunch(
      f.game,
      f.executable
    );
    await f.exported.markManagedEpicLaunched(prepared.session);
    f.exported.recordManagedEpicProcess(
      prepared.session,
      f.handle.pid,
      f.linuxContext,
      f.handle
    );
    await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", [
      f.linuxGameProcess,
    ]);
    await f.exported.onManagedEpicDetected(f.game, f.executable);
    f.state.tokenDisposeFailures = 1;
    await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", []);
    assert.equal(f.exported.onManagedEpicClosed(f.game), true);
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(f.state.tokenDisposeAttempts, 1);
    assert.equal(f.state.tokenDisposals, 0);
    assert.equal(f.state.leaseReleases, 0);
    assert.equal(f.exported.hasManagedEpicSession("epic:Namespace:Item"), true);
    assert.equal(f.exported.onManagedEpicClosed(f.game), true);
    assert.equal(f.state.closes, 1);
    assert.equal(f.state.reportsFinished, 1);
    let nextSession: typeof prepared.session | undefined;
    if (recovery === "clear") await f.exported.clearManagedEpicSessions();
    else if (recovery === "prepare")
      nextSession = (
        await f.exported.prepareManagedEpicLaunch(f.game, f.executable)
      ).session;
    else {
      await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", []);
      await new Promise<void>((done) => setImmediate(done));
    }
    assert.equal(f.state.tokenDisposeAttempts, 2);
    assert.equal(f.state.tokenDisposals, 1);
    assert.equal(f.state.leaseReleases, 1);
    assert.equal(f.state.closes, 1);
    assert.equal(f.state.reportsFinished, 1);
    assert.equal(f.state.terminations, 0);
    assert.equal(
      f.exported.hasManagedEpicSession("epic:Namespace:Item"),
      false
    );
    if (nextSession) await f.exported.cancelManagedEpicLaunch(nextSession);
  });
}

test("Linux reopening waits for closed-session local cleanup after its upload has finished", async (t) => {
  const f = await fixture(t, { linux: true });
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  f.exported.recordManagedEpicProcess(
    prepared.session,
    f.handle.pid,
    f.linuxContext,
    f.handle
  );
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", [
    f.linuxGameProcess,
  ]);
  await f.exported.onManagedEpicDetected(f.game, f.executable);
  let finishCleanup!: () => void;
  f.state.tokenDisposeWait = new Promise<void>((done) => {
    finishCleanup = done;
  });
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", []);
  assert.equal(f.exported.onManagedEpicClosed(f.game), true);
  await new Promise<void>((done) => setImmediate(done));
  let reopened = false;
  const next = f.exported
    .prepareManagedEpicLaunch(f.game, f.executable)
    .then((value) => {
      reopened = true;
      return value;
    });
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(reopened, false);
  assert.equal(f.state.closes, 1);
  assert.equal(f.state.leaseReleases, 0);
  assert.equal(f.state.authCalls, 1);
  finishCleanup();
  const ready = await next;
  assert.equal(reopened, true);
  assert.equal(f.state.tokenDisposeAttempts, 1);
  assert.equal(f.state.leaseReleases, 1);
  assert.equal(f.state.closes, 1);
  await f.exported.cancelManagedEpicLaunch(ready.session);
});

test("Linux cancellation waits for termination and retains the lease/token when cleanup fails", async (t) => {
  const f = await fixture(t, { linux: true });
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  f.exported.recordManagedEpicProcess(
    prepared.session,
    f.handle.pid,
    f.linuxContext,
    f.handle
  );
  let finishTermination!: () => void;
  f.state.terminateWait = new Promise<void>((done) => {
    finishTermination = done;
  });
  let cancelled = false;
  const pending = f.exported
    .cancelManagedEpicLaunch(prepared.session)
    .then(() => {
      cancelled = true;
    });
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(cancelled, false);
  assert.equal(f.state.leaseReleases, 0);
  assert.equal(f.state.tokenDisposals, 0);
  f.state.cleanupFails = true;
  finishTermination();
  await assert.rejects(pending, /cleanup-failed/);
  assert.equal(f.state.leaseReleases, 0);
  assert.equal(f.state.tokenDisposals, 0);
  assert.equal(f.exported.hasManagedEpicSession("epic:Namespace:Item"), true);
  f.state.cleanupFails = false;
  await f.exported.cancelManagedEpicLaunch(prepared.session);
  assert.equal(f.state.leaseReleases, 1);
  assert.equal(f.state.tokenDisposals, 1);
});

test("Linux signout releases resources prepared before spawn exactly once", async (t) => {
  const f = await fixture(t, { linux: true });
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  await f.exported.clearManagedEpicSessions();
  assert.equal(f.state.leaseReleases, 1);
  assert.equal(f.state.tokenDisposals, 1);
  assert.equal(f.exported.hasManagedEpicSession("epic:Namespace:Item"), false);
});

test("a prepared Linux launch cannot spawn after signout released its resources", async (t) => {
  const f = await fixture(t, { linux: true });
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  f.state.current = false;
  await f.exported.clearManagedEpicSessions();
  await assert.rejects(
    f.exported.launchPreparedEpicLinuxGame(
      prepared.session,
      prepared.parameters,
      {}
    ),
    /operation-cancelled/
  );
  assert.equal(f.state.launchCalls, 0);
  assert.equal(f.state.terminations, 0);
  assert.equal(f.state.tokenDisposals, 1);
  assert.equal(f.state.leaseReleases, 1);
});

test("a short Linux game is tracked and uploads saves before startup observation returns", async (t) => {
  const f = await fixture(t, { linux: true });
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  let observing!: () => void;
  const observed = new Promise<void>((resolve) => {
    observing = resolve;
  });
  let finishObservation!: () => void;
  const observation = new Promise<void>((resolve) => {
    finishObservation = resolve;
  });
  f.state.observeWait = () => {
    observing();
    return observation;
  };
  const launching = f.exported.launchPreparedEpicLinuxGame(
    prepared.session,
    prepared.parameters
  );
  await observed;
  const match = await f.exported.getManagedEpicProcessMatch(
    "epic:Namespace:Item",
    [f.linuxGameProcess]
  );
  assert.equal(match.path, f.executable);
  assert.equal(
    await f.exported.onManagedEpicDetected(f.game, f.executable),
    true
  );
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", []);
  assert.equal(f.exported.onManagedEpicClosed(f.game), true);
  assert.equal(f.state.closes, 1);
  assert.equal(f.state.leaseReleases, 0);
  finishObservation();
  await launching;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(f.state.reportsFinished, 1);
  assert.equal(f.state.tokenDisposals, 1);
  assert.equal(f.state.leaseReleases, 1);
});

test("signout during startup observation retains its captured handle until cleanup succeeds", async (t) => {
  for (const cleanupFails of [false, true]) {
    const f = await fixture(t, { linux: true });
    const prepared = await f.exported.prepareManagedEpicLaunch(
      f.game,
      f.executable
    );
    await f.exported.markManagedEpicLaunched(prepared.session);
    let observed!: () => void;
    const observing = new Promise<void>((resolve) => {
      observed = resolve;
    });
    f.state.observeWait = (signal) =>
      new Promise<void>((_resolve, reject) => {
        observed();
        signal?.addEventListener(
          "abort",
          () => reject(new EpicSaveFailure("operation-cancelled")),
          { once: true }
        );
      });
    let finishTermination!: () => void;
    f.state.terminateWait = new Promise<void>((resolve) => {
      finishTermination = resolve;
    });
    f.state.cleanupFails = cleanupFails;
    const launch = f.exported.launchPreparedEpicLinuxGame(
      prepared.session,
      prepared.parameters
    );
    const rejectedLaunch = assert.rejects(launch, {
      code: cleanupFails ? "cleanup-failed" : "operation-cancelled",
    });
    await observing;
    let settled = false;
    const clearing = f.exported.clearManagedEpicSessions().finally(() => {
      settled = true;
    });
    const checkedCleanup = cleanupFails
      ? assert.rejects(clearing, { code: "cleanup-failed" })
      : clearing;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    assert.equal(f.state.leaseReleases, 0);
    assert.equal(f.state.tokenDisposals, 0);
    finishTermination();
    await Promise.all([rejectedLaunch, checkedCleanup]);
    if (cleanupFails) {
      assert.equal(f.state.leaseReleases, 0);
      assert.equal(f.state.tokenDisposals, 0);
      f.state.cleanupFails = false;
      await f.exported.clearManagedEpicSessions();
      await f.exported.cancelManagedEpicLaunch(prepared.session);
    }
    assert.equal(f.state.leaseReleases, 1);
    assert.equal(f.state.tokenDisposals, 1);
  }
});

test("signout waits for a pending Linux spawn and confirmed termination before disposing its token or lease", async (t) => {
  const f = await fixture(t, { linux: true });
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  let entered!: () => void;
  const spawning = new Promise<void>((done) => {
    entered = done;
  });
  let finishSpawn!: () => void;
  const spawned = new Promise<void>((done) => {
    finishSpawn = done;
  });
  f.state.launchWait = async () => {
    entered();
    await spawned;
  };
  let finishTermination!: () => void;
  f.state.terminateWait = new Promise<void>((done) => {
    finishTermination = done;
  });
  const launch = f.exported.launchPreparedEpicLinuxGame(
    prepared.session,
    prepared.parameters,
    {}
  );
  const rejectedLaunch = assert.rejects(launch, /operation-cancelled/);
  await spawning;
  f.state.current = false;
  let cleared = false;
  const clearing = f.exported.clearManagedEpicSessions().then(() => {
    cleared = true;
  });
  try {
    await new Promise<void>((done) => setImmediate(done));
    assert.equal(f.state.launchSignals[0]?.aborted, true);
    assert.equal(cleared, false);
    assert.equal(f.state.tokenDisposals, 0);
    assert.equal(f.state.leaseReleases, 0);
    finishSpawn();
    await new Promise<void>((done) => setImmediate(done));
    assert.ok(f.state.terminations > 0);
    assert.equal(cleared, false);
    assert.equal(f.state.tokenDisposals, 0);
    assert.equal(f.state.leaseReleases, 0);
  } finally {
    finishSpawn();
    finishTermination();
  }
  await rejectedLaunch;
  await clearing;
  assert.equal(f.state.launchCalls, 1);
  assert.equal(f.state.tokenDisposals, 1);
  assert.equal(f.state.leaseReleases, 1);
  assert.equal(f.exported.hasManagedEpicSession("epic:Namespace:Item"), false);
  assert.equal(f.state.closes, 0);
});

test("a late Linux spawn with failed termination retains its ownership token and lease for retry", async (t) => {
  const f = await fixture(t, { linux: true });
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  let entered!: () => void;
  const spawning = new Promise<void>((done) => {
    entered = done;
  });
  let finishSpawn!: () => void;
  const spawned = new Promise<void>((done) => {
    finishSpawn = done;
  });
  f.state.launchWait = async () => {
    entered();
    await spawned;
  };
  const launch = f.exported.launchPreparedEpicLinuxGame(
    prepared.session,
    prepared.parameters,
    {}
  );
  const rejectedLaunch = assert.rejects(launch, /cleanup-failed/);
  await spawning;
  f.state.cleanupFails = true;
  f.state.current = false;
  const clearing = f.exported.clearManagedEpicSessions();
  const rejectedCleanup = assert.rejects(clearing, /cleanup-failed/);
  finishSpawn();
  await Promise.all([rejectedLaunch, rejectedCleanup]);
  assert.equal(f.state.tokenDisposals, 0);
  assert.equal(f.state.leaseReleases, 0);
  f.state.cleanupFails = false;
  await f.exported.cancelManagedEpicLaunch(prepared.session);
  assert.equal(f.state.tokenDisposals, 1);
  assert.equal(f.state.leaseReleases, 1);
});

test("Linux signout keeps the running game and token until proven exit, with no remote upload to the disconnected owner", async (t) => {
  const f = await fixture(t, { linux: true });
  const prepared = await f.exported.prepareManagedEpicLaunch(
    f.game,
    f.executable
  );
  await f.exported.markManagedEpicLaunched(prepared.session);
  f.exported.recordManagedEpicProcess(
    prepared.session,
    f.handle.pid,
    f.linuxContext,
    f.handle
  );
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", [
    f.linuxGameProcess,
  ]);
  await f.exported.onManagedEpicDetected(f.game, f.executable);
  await f.exported.clearManagedEpicSessions();
  assert.equal(f.exported.hasManagedEpicSession("epic:Namespace:Item"), true);
  assert.equal(f.state.leaseReleases, 0);
  assert.equal(f.state.terminations, 0);
  assert.equal(f.state.tokenDisposals, 0);
  await f.exported.getManagedEpicProcessMatch("epic:Namespace:Item", []);
  assert.equal(f.exported.onManagedEpicClosed(f.game), true);
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(f.state.closes, 0);
  assert.equal(f.state.leaseReleases, 1);
  assert.equal(f.state.tokenDisposals, 1);
});

test("signout reports failed bootstrap cleanup and retries it on later signout attempts", async (t) => {
  const f = await fixture(t, { linux: true });
  let entered!: () => void;
  const preparing = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.state.cleanupFails = true;
  f.state.prepareWait = (signal) =>
    new Promise<void>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          f.state.pendingPreparationCleanup = true;
          reject(new EpicSaveFailure("cleanup-failed"));
        },
        { once: true }
      );
      entered();
    });
  const launch = f.exported.prepareManagedEpicLaunch(f.game, f.executable);
  const rejected = assert.rejects(launch, { code: "cleanup-failed" });
  await preparing;
  await assert.rejects(f.exported.clearManagedEpicSessions(), {
    code: "cleanup-failed",
  });
  await rejected;
  assert.equal(f.state.preparationCleanupRetries, 0);
  await assert.rejects(f.exported.clearManagedEpicSessions(), {
    code: "cleanup-failed",
  });
  assert.equal(f.state.preparationCleanupRetries, 1);
  f.state.cleanupFails = false;
  await f.exported.clearManagedEpicSessions();
  assert.equal(f.state.preparationCleanupRetries, 2);
  assert.equal(f.state.pendingPreparationCleanup, false);
});

test("signout aborts a Linux preparation and waits for its cleanup before returning", async (t) => {
  const f = await fixture(t, { linux: true });
  let entered!: () => void;
  const preparing = new Promise<void>((done) => {
    entered = done;
  });
  let finishCleanup!: () => void;
  const cleaned = new Promise<void>((done) => {
    finishCleanup = done;
  });
  f.state.prepareWait = (signal) =>
    new Promise<void>((_resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => {
          void cleaned.then(() =>
            reject(new EpicSaveFailure("operation-cancelled"))
          );
        },
        { once: true }
      );
      entered();
    });
  const launch = f.exported.prepareManagedEpicLaunch(f.game, f.executable);
  await preparing;
  let finished = false;
  const clearing = f.exported.clearManagedEpicSessions().then(() => {
    finished = true;
  });
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(finished, false);
  assert.equal(f.state.authCalls, 0);
  finishCleanup();
  await assert.rejects(launch, /operation-cancelled/);
  await clearing;
  assert.equal(finished, true);
  assert.equal(f.state.authCalls, 0);
  assert.equal(f.state.leaseReleases, 0);
});
