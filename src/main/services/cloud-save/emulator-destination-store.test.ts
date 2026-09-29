import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

// @ts-ignore The Node ESM test runner requires the source extension.
import {
  emulatorDestinationKindForFile,
  isCurrentEmulatorDestinationBinding,
  isSafeExistingEmulatorDestination,
  isSameExistingEmulatorDestination,
} from "./emulator-destination-policy.ts";

describe("manual emulator restore destinations", () => {
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

  it("keeps PPSSPP save data and states bound to separate title roots", () => {
    assert.equal(
      emulatorDestinationKindForFile(
        "<emulator>/ppsspp/savedata/ULUS12345",
        "ULUS12345DATA/PARAM.SFO"
      ),
      "save"
    );
    assert.equal(
      emulatorDestinationKindForFile(
        "<emulator>/ppsspp/state/ULUS12345",
        "ULUS12345_1.00_0.ppst"
      ),
      "state"
    );
    assert.equal(
      emulatorDestinationKindForFile(
        "<emulator>/ppsspp/state/ULUS99999",
        "ULUS12345_1.00_0.ppst"
      ),
      null
    );
  });

  it("offers physical emulator roots but leaves shared card images to card binding", () => {
    assert.equal(
      emulatorDestinationKindForFile(
        "<emulator>/duckstation-state/SCUS-94163",
        "SCUS-94163_1.sav"
      ),
      "state"
    );
    assert.equal(
      emulatorDestinationKindForFile(
        "<emulator>/pcsx2-folder/SLUS-20294/1",
        "BASLUS-20294/save.bin"
      ),
      "save"
    );
    assert.equal(
      emulatorDestinationKindForFile(
        "<emulator>/dolphin-gci/A/GM8E01",
        "game.gci"
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
        "<emulator>/dolphin-raw/A/GM8E01",
        "save.gci"
      ),
      null
    );
    assert.equal(
      emulatorDestinationKindForFile(
        "<emulator>/duckstation-card/SCUS-94163/1",
        "save.mcs"
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
