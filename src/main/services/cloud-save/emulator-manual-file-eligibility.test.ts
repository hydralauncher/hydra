import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import type { Game } from "@types";

// @ts-ignore The Node ESM test runner requires the source extension.
import { isEligibleEmulatorManualFile } from "./emulator-manual-file-eligibility.ts";
// @ts-ignore The Node ESM test runner requires the source extension.
import { createRetroArchGameSaveFileFilter } from "./retroarch-save-config.ts";

const game = (platform: string, romPath: string) =>
  ({
    shop: "launchbox",
    platform,
    discs: [{ path: romPath }],
  }) as Game;

describe("manual emulator file identity", () => {
  it("accepts the ROM's .srm and rejects another game's .srm", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hydra-manual-save-"));
    try {
      const rom = path.join(root, "Super Mario World.sfc");
      const ownSave = path.join(root, "Super Mario World.srm");
      const otherSave = path.join(root, "Donkey Kong Country.srm");
      await Promise.all([
        fs.writeFile(rom, "rom"),
        fs.writeFile(ownSave, "own"),
        fs.writeFile(otherSave, "other"),
      ]);
      const selectedGame = game("Super Nintendo Entertainment System", rom);
      const filter = createRetroArchGameSaveFileFilter([rom], "snes");
      assert.equal(
        await isEligibleEmulatorManualFile(selectedGame, ownSave, filter),
        true
      );
      assert.equal(
        await isEligibleEmulatorManualFile(selectedGame, otherSave, filter),
        false
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("allows an explicitly selected N64 Transfer Pak .sav with an arbitrary GB name", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "hydra-transfer-pak-")
    );
    try {
      const rom = path.join(root, "Pokemon Stadium.z64");
      const transferPakSave = path.join(root, "Pokemon Red.sav");
      const unrelatedBattery = path.join(root, "Other Game.srm");
      const link = path.join(root, "linked.sav");
      await Promise.all([
        fs.writeFile(rom, "rom"),
        fs.writeFile(transferPakSave, "save"),
        fs.writeFile(unrelatedBattery, "other"),
      ]);
      await fs.symlink(transferPakSave, link);
      const selectedGame = game("Nintendo 64", rom);
      const filter = createRetroArchGameSaveFileFilter([rom], "n64");
      assert.equal(
        await isEligibleEmulatorManualFile(
          selectedGame,
          transferPakSave,
          filter
        ),
        true
      );
      assert.equal(
        await isEligibleEmulatorManualFile(
          selectedGame,
          unrelatedBattery,
          filter
        ),
        false
      );
      assert.equal(
        await isEligibleEmulatorManualFile(selectedGame, link, filter),
        false
      );
      assert.equal(
        await isEligibleEmulatorManualFile(
          game("Super Nintendo Entertainment System", rom),
          transferPakSave,
          async () => false
        ),
        false
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
