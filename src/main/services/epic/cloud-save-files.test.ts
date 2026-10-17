import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyEpicSaveSnapshot,
  copyEpicSaveSnapshot,
  inspectEpicSaveFiles,
} from "./cloud-save-files.js";

test("filtered snapshots preserve unrelated files and roll back an interrupted restore", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "epic-save-files-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, "local"),
    staging = path.join(root, "staging"),
    backup = path.join(root, "backup");
  await Promise.all([fs.mkdir(local), fs.mkdir(staging)]);
  await fs.writeFile(path.join(local, "profile.sav"), "original");
  await fs.writeFile(path.join(local, "game.exe"), "untouched");
  await fs.writeFile(path.join(staging, "profile.sav"), "remote");
  const metadata = { folder: "known", include: ["*.sav"], exclude: [] };
  const old = await inspectEpicSaveFiles(local, metadata);
  let calls = 0;
  await assert.rejects(
    applyEpicSaveSnapshot(staging, local, backup, metadata, old.digest, () => {
      if (++calls === 2) throw new Error("context changed");
    }),
    /context changed/
  );
  assert.equal(
    await fs.readFile(path.join(local, "profile.sav"), "utf8"),
    "original"
  );
  assert.equal(
    await fs.readFile(path.join(local, "game.exe"), "utf8"),
    "untouched"
  );
  const restored = await applyEpicSaveSnapshot(
    staging,
    local,
    path.join(root, "backup-success"),
    metadata,
    old.digest,
    () => {}
  );
  assert.equal(
    restored.digest,
    (await inspectEpicSaveFiles(staging, metadata)).digest
  );
  assert.equal(
    await fs.readFile(path.join(local, "game.exe"), "utf8"),
    "untouched"
  );
  await assert.rejects(
    applyEpicSaveSnapshot(
      staging,
      local,
      path.join(root, "backup-stale"),
      metadata,
      old.digest,
      () => {}
    ),
    /save-conflict/
  );
});
test("copies a stable snapshot and rejects symlinks and empty remote staging", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "epic-save-safe-paths-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source"),
    outside = path.join(root, "outside"),
    copy = path.join(root, "copy");
  await Promise.all([fs.mkdir(source), fs.mkdir(outside)]);
  await fs.writeFile(path.join(source, "slot.sav"), "content");
  const metadata = { folder: "known", include: ["*.sav"], exclude: [] };
  const snapshot = await inspectEpicSaveFiles(source, metadata);
  await copyEpicSaveSnapshot(source, copy, snapshot);
  assert.equal(
    (await inspectEpicSaveFiles(copy, metadata)).digest,
    snapshot.digest
  );
  await assert.rejects(
    applyEpicSaveSnapshot(
      outside,
      source,
      path.join(root, "backup"),
      metadata,
      snapshot.digest,
      () => {}
    ),
    /save-verification-failed/
  );
  const link = path.join(source, "escape");
  await fs.symlink(outside, link, "junction");
  await assert.rejects(inspectEpicSaveFiles(source, metadata), /invalid-path/);
});

test("an edit during backup copying remains local and prevents destructive restore", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "epic-save-copy-race-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, "local"),
    staging = path.join(root, "staging"),
    backup = path.join(root, "backup");
  await Promise.all([fs.mkdir(local), fs.mkdir(staging)]);
  const save = path.join(local, "profile.sav");
  await fs.writeFile(save, "original");
  await fs.writeFile(path.join(staging, "profile.sav"), "remote");
  const metadata = { folder: "known", include: ["*.sav"], exclude: [] };
  const before = await inspectEpicSaveFiles(local, metadata);
  const copy = fs.copyFile;
  t.mock.method(fs, "copyFile", async (source: string, target: string) => {
    await copy(source, target);
    if (target === path.join(backup, "profile.sav"))
      await fs.writeFile(save, "concurrent local edit");
  });
  await assert.rejects(
    applyEpicSaveSnapshot(
      staging,
      local,
      backup,
      metadata,
      before.digest,
      () => {}
    ),
    /save-conflict/
  );
  assert.equal(await fs.readFile(save, "utf8"), "concurrent local edit");
});

test("an incomplete backup prevents replacement and preserves the original save", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "epic-save-copy-integrity-")
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const local = path.join(root, "local"),
    staging = path.join(root, "staging"),
    backup = path.join(root, "backup");
  await Promise.all([fs.mkdir(local), fs.mkdir(staging)]);
  const save = path.join(local, "profile.sav");
  await fs.writeFile(save, "original");
  await fs.writeFile(path.join(staging, "profile.sav"), "remote");
  const metadata = { folder: "known", include: ["*.sav"], exclude: [] };
  const before = await inspectEpicSaveFiles(local, metadata);
  const copy = fs.copyFile;
  t.mock.method(fs, "copyFile", async (source: string, target: string) => {
    await copy(source, target);
    if (target === path.join(backup, "profile.sav"))
      await fs.writeFile(target, "incomplete backup");
  });
  await assert.rejects(
    applyEpicSaveSnapshot(
      staging,
      local,
      backup,
      metadata,
      before.digest,
      () => {}
    ),
    /save-verification-failed/
  );
  assert.equal(await fs.readFile(save, "utf8"), "original");
});
