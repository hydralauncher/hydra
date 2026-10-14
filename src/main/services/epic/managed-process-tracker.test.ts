import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EpicManagedProcessTracker } from "./managed-process-tracker.js";
import type { EpicProcessNode } from "./managed-process-tracker.js";

test("keeps the real child alive after its captured bootstrapper exits, without matching unrelated games", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "epic-process-tree-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bootstrap = path.join(root, "bootstrap.exe"),
    shipping = path.join(root, "shipping.exe");
  await Promise.all([
    fs.writeFile(bootstrap, "fixture"),
    fs.writeFile(shipping, "fixture"),
  ]);
  const tracker = new EpicManagedProcessTracker(100, root);
  assert.deepEqual(
    (
      await tracker.scan([
        { pid: 100, parentPid: 99, exe: bootstrap },
        { pid: 101, parentPid: 100, exe: shipping },
      ])
    ).paths.sort(),
    [bootstrap, shipping].sort()
  );
  assert.deepEqual(
    await tracker.scan([{ pid: 101, parentPid: 100, exe: shipping }]),
    { complete: true, paths: [shipping] }
  );
  assert.deepEqual(
    await tracker.scan([{ pid: 102, parentPid: 101, exe: shipping }]),
    { complete: true, paths: [shipping] }
  );
  assert.deepEqual(
    await tracker.scan([{ pid: 200, parentPid: 199, exe: shipping }]),
    { complete: true, paths: [] }
  );
  assert.deepEqual(await tracker.scan([]), { complete: true, paths: [] });
  const immediateExit = new EpicManagedProcessTracker(100, root);
  assert.deepEqual(
    await immediateExit.scan([{ pid: 101, parentPid: 100, exe: shipping }]),
    { complete: true, paths: [shipping] }
  );
});

test("missing ancestry/executable information and realpath escapes never prove a close", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "epic-process-proof-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const install = path.join(root, "install"),
    outside = path.join(root, "outside");
  await Promise.all([fs.mkdir(install), fs.mkdir(outside)]);
  const game = path.join(install, "game.exe"),
    foreign = path.join(outside, "game.exe");
  await Promise.all([
    fs.writeFile(game, "fixture"),
    fs.writeFile(foreign, "fixture"),
  ]);
  const tracker = new EpicManagedProcessTracker(100, install);
  assert.equal((await tracker.scan([{ pid: 101, exe: game }])).complete, false);
  assert.equal(
    (await tracker.scan([{ pid: 101, parentPid: 100, exe: null }])).complete,
    false
  );
  assert.deepEqual(
    await tracker.scan([{ pid: 101, parentPid: 100, exe: foreign }]),
    { complete: false, paths: [] }
  );
  const link = path.join(install, "escape");
  await fs.symlink(outside, link, "junction");
  assert.deepEqual(
    await tracker.scan([
      { pid: 101, parentPid: 100, exe: path.join(link, "game.exe") },
    ]),
    { complete: false, paths: [] }
  );
});

test("retains a proven external intermediary until its delayed game descendant exits", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "epic-process-wrapper-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const install = path.join(root, "install");
  await fs.mkdir(install);
  const bootstrap = path.join(install, "bootstrap.exe");
  const game = path.join(install, "game.exe");
  const intermediary = path.join(root, "wrapper.exe");
  await Promise.all(
    [bootstrap, game, intermediary].map((file) => fs.writeFile(file, "fixture"))
  );
  const tracker = new EpicManagedProcessTracker(100, install);
  assert.deepEqual(
    (
      await tracker.scan([
        { pid: 100, parentPid: 99, exe: bootstrap },
        { pid: 101, parentPid: 100, exe: intermediary },
      ])
    ).paths,
    [bootstrap]
  );
  assert.deepEqual(
    await tracker.scan([{ pid: 101, parentPid: 100, exe: intermediary }]),
    {
      complete: false,
      paths: [],
    }
  );
  assert.deepEqual(
    await tracker.scan([{ pid: 102, parentPid: 101, exe: game }]),
    {
      complete: true,
      paths: [game],
    }
  );
  assert.deepEqual(await tracker.scan([]), { complete: true, paths: [] });
});

async function linuxFixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "epic-linux-proof-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const install = path.join(root, "Game");
  const prefix = path.join(root, "Prefix");
  const game = path.join(install, "Game.exe");
  const overlay = path.join(prefix, "EOSOverlayRenderer-Win64-Shipping.exe");
  await Promise.all([fs.mkdir(install), fs.mkdir(prefix)]);
  await Promise.all(
    [game, overlay].map((file) => fs.writeFile(file, "MZfixture"))
  );
  const node = (patch: Partial<EpicProcessNode> = {}): EpicProcessNode => ({
    pid: 101,
    parentPid: 100,
    exe: path.join(root, "wine64-preloader"),
    startTime: "1001",
    invocationId: "launch-a",
    winePrefixPath: prefix,
    peExecutablePath: game,
    inspectionComplete: true,
    ...patch,
  });
  return {
    root,
    install,
    prefix,
    game,
    overlay,
    node,
    tracker: new EpicManagedProcessTracker(100, install, {
      invocationId: "launch-a",
      winePrefixPath: prefix,
    }),
  };
}

test("Linux proves the mapped PE with an invocation and prefix, not the Wine loader path", async (t) => {
  const f = await linuxFixture(t);
  assert.deepEqual(await f.tracker.scan([f.node()]), {
    complete: true,
    paths: [f.game],
  });
  assert.deepEqual(
    await f.tracker.scan([
      f.node({ invocationId: "other-launch" }),
      f.node({ pid: 102, winePrefixPath: path.join(f.root, "other-prefix") }),
    ]),
    { complete: true, paths: [] }
  );
});

test("Linux retains a reparented child and ignores a surviving native wrapper and known PE overlay", async (t) => {
  const f = await linuxFixture(t);
  const wrapper = f.node({
    pid: 100,
    parentPid: 90,
    startTime: "1000",
    exe: path.join(f.root, "python"),
    peExecutablePath: null,
  });
  assert.deepEqual(await f.tracker.scan([wrapper, f.node()]), {
    complete: true,
    paths: [f.game],
  });
  assert.deepEqual(
    await f.tracker.scan([f.node({ parentPid: 1, invocationId: null })]),
    { complete: true, paths: [f.game] }
  );
  assert.deepEqual(
    await f.tracker.scan([
      wrapper,
      f.node({ pid: 102, startTime: "1002", peExecutablePath: f.overlay }),
    ]),
    { complete: true, paths: [] }
  );
});

test("Linux ancestry is independent of enumeration order and missing token requires proven parent identity", async (t) => {
  const f = await linuxFixture(t);
  const wrapper = f.node({
    pid: 100,
    startTime: "1000",
    peExecutablePath: null,
  });
  assert.deepEqual(
    await f.tracker.scan([f.node({ invocationId: null }), wrapper]),
    { complete: true, paths: [f.game] }
  );
  const other = new EpicManagedProcessTracker(100, f.install, {
    invocationId: "launch-a",
    winePrefixPath: f.prefix,
  });
  assert.deepEqual(await other.scan([f.node({ invocationId: null })]), {
    complete: false,
    paths: [],
  });
});

test("Linux PID reuse does not retain ownership or attribute a new foreign child", async (t) => {
  const f = await linuxFixture(t);
  await f.tracker.scan([f.node()]);
  assert.deepEqual(
    await f.tracker.scan([
      f.node({ startTime: "9999", invocationId: "other-launch" }),
      f.node({
        pid: 102,
        parentPid: 101,
        startTime: "10000",
        invocationId: null,
        winePrefixPath: null,
      }),
    ]),
    { complete: true, paths: [] }
  );
  assert.deepEqual(
    await f.tracker.scan([
      f.node({
        pid: 102,
        parentPid: 101,
        startTime: "10000",
        invocationId: null,
        winePrefixPath: null,
      }),
    ]),
    { complete: true, paths: [] }
  );
});

test("Linux candidate inspection failures remain unknown but unrelated inaccessible processes do not freeze close", async (t) => {
  const f = await linuxFixture(t);
  await f.tracker.scan([f.node()]);
  assert.deepEqual(
    await f.tracker.scan([
      f.node({
        invocationId: null,
        winePrefixPath: null,
        peExecutablePath: null,
        inspectionComplete: false,
      }),
    ]),
    { complete: false, paths: [] }
  );
  assert.deepEqual(
    await f.tracker.scan([
      { pid: 1, exe: null, startTime: "1", inspectionComplete: false },
    ]),
    { complete: true, paths: [] }
  );
  assert.deepEqual(
    await f.tracker.scan([
      f.node({ startTime: null, inspectionComplete: false }),
    ]),
    { complete: false, paths: [] }
  );
});

test("Linux unknown external Windows writers prevent close and symlink escapes never count as the game", async (t) => {
  const f = await linuxFixture(t);
  const writer = path.join(f.prefix, "save-helper.exe");
  await fs.writeFile(writer, "MZfixture");
  assert.deepEqual(
    await f.tracker.scan([
      f.node({
        parentPid: 1,
        invocationId: null,
        peExecutablePath: writer,
      }),
    ]),
    { complete: false, paths: [] }
  );
  assert.deepEqual(
    await f.tracker.scan([f.node({ peExecutablePath: writer })]),
    { complete: false, paths: [] }
  );
  const link = path.join(f.install, "escape");
  await fs.symlink(f.prefix, link, "junction");
  assert.deepEqual(
    await f.tracker.scan([
      f.node({ peExecutablePath: path.join(link, "save-helper.exe") }),
    ]),
    { complete: false, paths: [] }
  );
  assert.deepEqual(
    await f.tracker.scan([
      f.node({
        pid: 103,
        invocationId: null,
        parentPid: 1,
        peExecutablePath: f.overlay,
      }),
      f.node({
        pid: 104,
        invocationId: null,
        parentPid: 1,
        peExecutablePath: null,
      }),
    ]),
    { complete: true, paths: [] }
  );
});

test("Linux root identity can prove descendants without a token and preserves prefix casing", async (t) => {
  const f = await linuxFixture(t);
  const tracker = new EpicManagedProcessTracker(100, f.install, {
    invocationId: "launch-a",
    winePrefixPath: f.prefix,
    rootStartTime: "1000",
  });
  assert.deepEqual(
    await tracker.scan([
      f.node({ invocationId: null }),
      f.node({
        pid: 100,
        startTime: "1000",
        invocationId: null,
        peExecutablePath: null,
      }),
    ]),
    { complete: true, paths: [f.game] }
  );
  assert.deepEqual(
    await tracker.scan([f.node({ winePrefixPath: f.prefix.toLowerCase() })]),
    { complete: true, paths: [] }
  );
});
