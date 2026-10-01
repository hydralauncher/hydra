import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { isExecutableMissingFromAvailableStorage } from "./executable-availability-core.js";

describe("isExecutableMissingFromAvailableStorage", () => {
  it("keeps executables that still exist", async (t) => {
    const directory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-exe-")
    );
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    const executable = path.join(directory, "game.exe");
    await fs.promises.writeFile(executable, "");

    assert.equal(
      await isExecutableMissingFromAvailableStorage(executable),
      false
    );
  });

  it("flags executables removed from a reachable drive", async (t) => {
    const directory = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "hydra-exe-")
    );
    t.after(() => fs.promises.rm(directory, { recursive: true, force: true }));
    await fs.promises.writeFile(path.join(directory, "other-game.exe"), "");

    assert.equal(
      await isExecutableMissingFromAvailableStorage(
        path.join(directory, "Removed Game", "game.exe")
      ),
      true
    );
  });

  it(
    "keeps executables under an empty folder that may be an unmounted volume",
    { skip: process.platform === "win32" },
    async (t) => {
      const mountPoint = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "hydra-mount-")
      );
      t.after(() =>
        fs.promises.rm(mountPoint, { recursive: true, force: true })
      );

      assert.equal(
        await isExecutableMissingFromAvailableStorage(
          path.join(mountPoint, "Game", "game.exe")
        ),
        false
      );
    }
  );

  it("keeps executables on posix drives that are not mounted", async () => {
    assert.equal(
      await isExecutableMissingFromAvailableStorage(
        "/media/hydra-test-user/Offline Drive/Game/game.exe",
        "linux"
      ),
      false
    );
    assert.equal(
      await isExecutableMissingFromAvailableStorage(
        "/hydra-missing-mount/Game/game.exe",
        "linux"
      ),
      false
    );
  });

  it("keeps executables on Windows drives that are not connected", async () => {
    assert.equal(
      await isExecutableMissingFromAvailableStorage(
        String.raw`Q:\Games\Offline\game.exe`,
        "win32"
      ),
      false
    );
  });

  it("ignores relative paths", async () => {
    assert.equal(
      await isExecutableMissingFromAvailableStorage("game.exe"),
      false
    );
  });
});
