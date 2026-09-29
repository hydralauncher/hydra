import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { writeArchivedEmulationSave } from "./write-archived-emulation-save.js";

const withTempDir = async (run: (directory: string) => Promise<void>) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "hydra-archive-test-")
  );
  try {
    await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
};

describe("archived emulation save download", () => {
  it("writes a downloaded backup without touching other files", async () => {
    await withTempDir(async (directory) => {
      const destination = path.join(directory, "game-a.psu");
      const otherGame = path.join(directory, "game-b.psu");
      await fs.writeFile(otherGame, "other-game");

      await writeArchivedEmulationSave(destination, Buffer.from("game-a"));

      assert.equal(await fs.readFile(destination, "utf8"), "game-a");
      assert.equal(await fs.readFile(otherGame, "utf8"), "other-game");
      assert.deepEqual((await fs.readdir(directory)).sort(), [
        "game-a.psu",
        "game-b.psu",
      ]);
    });
  });

  it("replaces a confirmed target and removes temporary files", async () => {
    await withTempDir(async (directory) => {
      const destination = path.join(directory, "game-a.psu");
      await fs.writeFile(destination, "old-save");

      await writeArchivedEmulationSave(destination, Buffer.from("new-save"));

      assert.equal(await fs.readFile(destination, "utf8"), "new-save");
      assert.deepEqual(await fs.readdir(directory), ["game-a.psu"]);
    });
  });

  it("restores original bytes if replacing the target fails", async () => {
    await withTempDir(async (directory) => {
      const destination = path.join(directory, "game-a.psu");
      await fs.writeFile(destination, "old-save");
      const files = {
        lstat: fs.lstat,
        writeFile: fs.writeFile,
        rm: fs.rm,
        rename: async (
          source: Parameters<typeof fs.rename>[0],
          target: Parameters<typeof fs.rename>[1]
        ) => {
          if (
            String(source).endsWith(".tmp") &&
            String(target) === destination
          ) {
            throw new Error("rename-failed");
          }
          return fs.rename(source, target);
        },
      };

      await assert.rejects(
        writeArchivedEmulationSave(destination, Buffer.from("new-save"), files),
        /rename-failed/
      );
      assert.equal(await fs.readFile(destination, "utf8"), "old-save");
      assert.deepEqual(await fs.readdir(directory), ["game-a.psu"]);
    });
  });

  it("rejects symlinks and directories as export targets", async () => {
    await withTempDir(async (directory) => {
      const linked = path.join(directory, "link.psu");
      const original = path.join(directory, "original.psu");
      await fs.writeFile(original, "original");
      await assert.rejects(
        writeArchivedEmulationSave(directory, Buffer.from("new")),
        /archive_export_invalid_target/
      );

      try {
        await fs.symlink(original, linked);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
        return;
      }
      await assert.rejects(
        writeArchivedEmulationSave(linked, Buffer.from("new")),
        /archive_export_symlink_target/
      );
      assert.equal(await fs.readFile(original, "utf8"), "original");
    });
  });
});
