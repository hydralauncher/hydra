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

async function fixture(t: TestContext) {
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
  };
  const session = {
    objectId: "Namespace:Item",
    target: { owner: { userId: "captured" }, artifactId: "Artifact" },
    installed: {
      executablePath: executable,
      installPath: root,
      can_run_offline: true,
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
      session.installed.can_run_offline = state.canRunOffline;
      return session;
    },
    beforeLaunch: async () => {
      if (state.conflict) throw new EpicSaveFailure("save-conflict");
    },
    markSessionStarted: async () => {
      state.starts++;
    },
    afterClose: async () => {
      state.closes++;
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
        return result();
      },
      runOfflineLaunch: async () => {
        state.offlineCalls++;
        return { ...result(), game_parameters: ["-AUTH_TYPE=offline"] };
      },
    },
  } as never);
  const game = { shop: "epic", objectId: "Namespace:Item" } as Game;
  return { exported, state, session, executable, child, game };
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
  assert.equal(f.exported.onManagedEpicClosed(f.game), false);
  assert.equal(f.state.closes, 1);
  assert.equal(f.state.reportsFinished, 1);
  assert.equal(f.state.reportsInterrupted, 2);
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
  f.exported.cancelManagedEpicLaunch(prepared.session);
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
  f.exported.clearManagedEpicSessions();
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
