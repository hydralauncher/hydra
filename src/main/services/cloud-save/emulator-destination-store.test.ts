import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  emulatorDestinationKindForFile,
  groupEmulatorRestoreDestinations,
  isCurrentEmulatorDestinationBinding,
  isSafeExistingEmulatorDestination,
  isSameExistingEmulatorDestination,
} from "./emulator-destination-policy.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { cloudSaveFileKey } from "./cloud-save-contract.ts";

describe("manual emulator restore destinations", () => {
  it("never asks for a manual destination for game-scoped RetroArch saves", () => {
    const rawPath = "<emulator>/retroarch-v2/snes";
    const files = ["battery.srm", `states/${"a".repeat(64)}.state`].map(
      (relativePath) => ({ variantId: "variant", rawPath, relativePath })
    );
    assert.deepEqual(
      groupEmulatorRestoreDestinations(
        files,
        new Set(files.map(cloudSaveFileKey)),
        new Set()
      ),
      []
    );
  });
  it("hides automatic RetroArch roots while keeping ambiguous files pending", () => {
    const rawPath = "<emulator>/retroarch/snes/1234ABCD";
    const files = ["battery.srm", "state.state1", "state.state2"].map(
      (relativePath) => ({ variantId: "variant", rawPath, relativePath })
    );
    const ids = files.map(cloudSaveFileKey);
    const grouped = groupEmulatorRestoreDestinations(
      files,
      new Set(ids),
      new Set(ids.slice(0, 2))
    );
    assert.deepEqual(
      grouped.map(({ kind, fileCount, needsDestination }) => ({
        kind,
        fileCount,
        needsDestination,
      })),
      [
        { kind: "save", fileCount: 1, needsDestination: false },
        { kind: "state", fileCount: 2, needsDestination: true },
      ]
    );
    assert.equal(
      groupEmulatorRestoreDestinations(files, new Set(ids), new Set(ids)).some(
        (group) => group.needsDestination
      ),
      false
    );
    assert.equal(
      groupEmulatorRestoreDestinations(files, new Set(ids), new Set())[0]
        .needsDestination,
      true
    );
  });

  it("splits RetroArch save and state roots without binding Transfer Pak to the save root", () => {
    const rawPath = "<emulator>/retroarch/snes/1234ABCD";
    assert.equal(
      emulatorDestinationKindForFile(rawPath, "battery.srm"),
      "save"
    );
    assert.equal(
      emulatorDestinationKindForFile(rawPath, "battery.rtc"),
      "save"
    );
    assert.equal(
      emulatorDestinationKindForFile(rawPath, "state.state2"),
      "state"
    );
    assert.equal(
      emulatorDestinationKindForFile(rawPath, "state.state2.png"),
      "state"
    );
    assert.equal(
      emulatorDestinationKindForFile(rawPath, "transfer-pak.sav"),
      null
    );
    assert.equal(
      emulatorDestinationKindForFile("<winDocuments>/Game", "battery.srm"),
      null
    );
  });

  it("recognizes RPCS3 save data and states", () => {
    assert.equal(
      emulatorDestinationKindForFile(
        "<emulator>/rpcs3/BLUS30443/00000001",
        "BLUS30443-SLOT/DATA.BIN"
      ),
      "save"
    );
    assert.equal(
      emulatorDestinationKindForFile(
        "<emulator>/rpcs3-state/BLUS30443",
        "BLUS30443_1_0.SAVESTAT.zst"
      ),
      "state"
    );
    assert.equal(
      emulatorDestinationKindForFile(
        "<emulator>/rpcs3/INVALID/00000001",
        "DATA.BIN"
      ),
      null
    );
  });

  it("requires an existing real directory and rejects symlinks", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-destination-"));
    try {
      const root = path.join(temp, "saves");
      const link = path.join(temp, "link");
      await fs.mkdir(root);
      await fs.symlink(root, link, "dir");
      assert.equal(await isSafeExistingEmulatorDestination(root), true);
      assert.equal(await isSafeExistingEmulatorDestination(link), false);
      const alias = path.join(temp, "alias");
      await fs.symlink(temp, alias, "dir");
      assert.equal(
        await isSameExistingEmulatorDestination(
          root,
          path.join(alias, "saves")
        ),
        true
      );
      assert.equal(await isSameExistingEmulatorDestination(link, root), false);
      const rootStat = await fs.lstat(root);
      const bound = {
        path: path.join(alias, "saves"),
        canonicalPath: await fs.realpath(root),
        device: rootStat.dev,
        inode: rootStat.ino,
      };
      assert.equal(
        await isCurrentEmulatorDestinationBinding(
          bound,
          path.join(alias, "saves"),
          path.join(alias, "saves")
        ),
        true
      );
      const other = path.join(temp, "other");
      await fs.mkdir(other);
      await fs.mkdir(path.join(other, "saves"));
      await fs.rename(alias, path.join(temp, "old-alias"));
      await fs.symlink(other, alias, "dir");
      assert.equal(
        await isCurrentEmulatorDestinationBinding(
          bound,
          path.join(alias, "saves"),
          path.join(alias, "saves")
        ),
        false
      );
      assert.equal(
        await isSafeExistingEmulatorDestination(path.join(temp, "missing")),
        false
      );
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
});
