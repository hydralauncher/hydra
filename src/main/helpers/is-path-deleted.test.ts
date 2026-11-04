import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { isPathDeleted } from "./is-path-deleted.ts";

describe("isPathDeleted", () => {
  let tempDir: string;
  let tempFile: string;

  before(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-is-path-deleted-")
    );
    tempFile = path.join(tempDir, "game.exe");
  });

  after(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Windows may keep a handle open (antivirus, indexer). Ignore cleanup failures.
    }
  });

  beforeEach(async () => {
    await fs.mkdir(tempDir, { recursive: true });
    await fs.writeFile(tempFile, "fake executable");
  });

  it("returns false when the target file exists", async () => {
    assert.equal(await isPathDeleted(tempFile), false);
  });

  it("returns true when the file was removed but its folder still exists", async () => {
    await fs.unlink(tempFile);
    assert.equal(await isPathDeleted(tempFile), true);
  });

  it("returns true for a file that never existed inside an existing folder", async () => {
    const neverExisted = path.join(tempDir, "never-installed.exe");
    assert.equal(await isPathDeleted(neverExisted), true);
  });

  it("returns false when the whole game folder is missing (unknown, not deleted)", async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    assert.equal(await isPathDeleted(tempFile), false);
  });

  it("returns false for a missing folder on an unplugged or unreachable drive", async () => {
    const target =
      process.platform === "win32"
        ? "Z:\\hydra-unplugged\\Game\\game.exe"
        : "/mnt/hydra-unplugged/Game/game.exe";
    assert.equal(await isPathDeleted(target), false);
  });

  it("returns false for an existing directory (not a file)", async () => {
    assert.equal(await isPathDeleted(tempDir), false);
  });

  it("does not throw for malformed paths", async () => {
    await assert.doesNotReject(() => isPathDeleted(""));
    await assert.doesNotReject(() => isPathDeleted("\0invalid"));
  });

  it("returns true when the executable is removed from its game folder", async () => {
    const gameDir = path.join(tempDir, "empty-game-folder");
    await fs.mkdir(gameDir, { recursive: true });

    const target = path.join(gameDir, "game.exe");
    assert.equal(await isPathDeleted(target), true);
  });
});
