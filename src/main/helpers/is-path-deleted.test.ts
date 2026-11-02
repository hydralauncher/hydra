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

  it("returns true when the target file was deleted externally", async () => {
    await fs.unlink(tempFile);
    assert.equal(await isPathDeleted(tempFile), true);
  });

  it("returns true when the entire parent folder was deleted", async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    assert.equal(await isPathDeleted(tempFile), true);
  });

  it("returns true for a path that never existed inside an existing folder", async () => {
    const neverExisted = path.join(tempDir, "never-installed.exe");
    assert.equal(await isPathDeleted(neverExisted), true);
  });

  it("returns false for an existing directory (not a file)", async () => {
    assert.equal(await isPathDeleted(tempDir), false);
  });

  it("returns false when the drive/volume root is unreachable", async () => {
    if (process.platform === "win32") {
      // Z: is unlikely to be mounted during tests.
      assert.equal(await isPathDeleted("Z:\\fake\\game.exe"), false);
    } else {
      // A mount point that does not exist simulates an unplugged drive.
      assert.equal(
        await isPathDeleted("/mnt/hydra-nonexistent-drive/game.exe"),
        false
      );
    }
  });

  it("treats an unplugged removable volume as not-deleted on macOS/Linux", async () => {
    if (process.platform === "win32") return;

    // /Volumes/... on macOS and /media/<user>/<label> on Linux live under
    // REMOVABLE_VOLUME_ROOTS. If the volume itself is gone, the path is not
    // considered deleted (it may simply be unplugged).
    const removableRoots: Array<[string, string]> = [
      ["/Volumes", "/Volumes/HydraUnpluggedDrive/game.exe"],
      ["/mnt", "/mnt/hydra-unplugged/game.exe"],
      ["/media", "/media/hydra-user/UNPLUGGED/game.exe"],
      ["/run/media", "/run/media/hydra-user/UNPLUGGED/game.exe"],
    ];
    for (const [root, target] of removableRoots) {
      if (!root.startsWith("/")) continue;
      const result = await isPathDeleted(target);
      assert.equal(result, false, `expected false for ${target}`);
    }
  });

  it("resolves relative paths against cwd", async () => {
    const relative = path.relative(process.cwd(), tempFile);
    if (!relative) return; // temp dir is cwd; nothing to assert
    assert.equal(await isPathDeleted(relative), false);
    await fs.unlink(tempFile);
    assert.equal(await isPathDeleted(relative), true);
  });

  it("does not throw for malformed paths", async () => {
    await assert.doesNotReject(() => isPathDeleted(""));
    await assert.doesNotReject(() => isPathDeleted("\0invalid"));
  });

  it("returns false for a path directly inside an empty mounted volume root", async () => {
    if (process.platform === "win32") return;

    // Simulate a mounted volume root that exists but is empty (unmounted drive)
    const emptyVolumeRoot = path.join(tempDir, "mnt", "disk");
    await fs.mkdir(emptyVolumeRoot, { recursive: true });
    
    const target = path.join(emptyVolumeRoot, "game.exe");
    
    // The file doesn't exist, but the volume root is empty, so it's considered offline
    assert.equal(await isPathDeleted(target), false);
  });
});