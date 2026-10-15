import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EpicManagedProcessTracker } from "./managed-process-tracker.js";

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
