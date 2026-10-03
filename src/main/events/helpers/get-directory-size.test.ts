import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { setImmediate } from "node:timers/promises";
import { getDirectorySize } from "./get-directory-size.js";

it("counts nested files with bounded concurrent metadata reads", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hydra-size-scan-"));
  try {
    await mkdir(path.join(root, "nested", "empty"), { recursive: true });
    let expected = 0;
    for (let index = 0; index < 40; index++) {
      const size = index + 1;
      expected += size;
      await writeFile(
        path.join(index % 2 ? root : path.join(root, "nested"), `${index}.bin`),
        Buffer.alloc(size)
      );
    }

    const originalStat = fs.promises.stat;
    let active = 0;
    let peak = 0;
    t.mock.method(fs.promises, "stat", async (filePath: string) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await setImmediate();
        return await originalStat(filePath);
      } finally {
        active--;
      }
    });
    assert.equal(await getDirectorySize(root), expected);
    assert.equal(peak, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("handles single files, empty folders and missing paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hydra-size-path-"));
  try {
    assert.equal(await getDirectorySize(root), 0);
    const file = path.join(root, "file.bin");
    await writeFile(file, Buffer.alloc(37));
    assert.equal(await getDirectorySize(file), 37);
    assert.equal(await getDirectorySize(path.join(root, "missing")), 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("skips inaccessible files without dropping the rest of the size", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hydra-size-errors-"));
  try {
    const missing = path.join(root, "unreadable.bin");
    await writeFile(missing, Buffer.alloc(100));
    await writeFile(path.join(root, "readable.bin"), Buffer.alloc(25));
    const originalStat = fs.promises.stat;
    t.mock.method(fs.promises, "stat", async (filePath: string) => {
      if (filePath === missing) throw new Error("Access denied");
      return originalStat(filePath);
    });
    assert.equal(await getDirectorySize(root), 25);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("does not follow nested directory symlinks or cycles", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hydra-size-symlink-"));
  try {
    await writeFile(path.join(root, "game.bin"), Buffer.alloc(23));
    try {
      await symlink(
        root,
        path.join(root, "cycle"),
        process.platform === "win32" ? "junction" : "dir"
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("Creating directory symlinks is not permitted");
        return;
      }
      throw error;
    }
    assert.equal(await getDirectorySize(root), 23);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
