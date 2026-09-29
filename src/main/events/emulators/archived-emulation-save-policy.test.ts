import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EmulationCloudSave, EmulationSavePlatform } from "@types";

import {
  getArchivedEmulationSaveEmulator,
  isArchivedEmulationSaveForExport,
  isArchivedEmulationSaveForGame,
  loadArchivedEmulationSaves,
  sanitizeArchivedEmulationFileName,
} from "./archived-emulation-save-policy.js";

const save = {
  id: "backup",
  shop: "launchbox",
  objectId: "game-a",
  platform: "ps2",
  emulator: "pcsx2",
} as EmulationCloudSave;

describe("archived emulation save export", () => {
  it("uses a stable emulator for remote archives without local installation", () => {
    assert.equal(getArchivedEmulationSaveEmulator("ps1"), "duckstation");
    assert.equal(getArchivedEmulationSaveEmulator("ps2"), "pcsx2");
    assert.equal(getArchivedEmulationSaveEmulator("psp"), "ppsspp");
    assert.equal(getArchivedEmulationSaveEmulator("gamecube"), "dolphin");
    assert.equal(getArchivedEmulationSaveEmulator("wii"), "dolphin");
    assert.throws(
      () =>
        getArchivedEmulationSaveEmulator(
          undefined as unknown as EmulationSavePlatform
        ),
      /invalid_emulation_save_platform/
    );
  });

  it("lists and filters archives without local emulator configuration", async () => {
    const queries: unknown[][] = [];
    const listRemote = async (...args: unknown[]) => {
      queries.push(args);
      return [save, { ...save, id: "other-game", objectId: "game-b" }];
    };

    const linked = await loadArchivedEmulationSaves(
      "ps2",
      "game-a",
      listRemote
    );
    assert.deepEqual(queries, [["ps2", "pcsx2", "game-a"]]);
    assert.deepEqual(
      linked.map((item) => item.id),
      ["backup"]
    );

    queries.length = 0;
    const all = await loadArchivedEmulationSaves("ps2", null, listRemote);
    assert.deepEqual(queries, [["ps2", "pcsx2", null]]);
    assert.deepEqual(
      all.map((item) => item.id),
      ["backup", "other-game"]
    );
  });
  it("exports only a backup linked to this LaunchBox game", () => {
    assert.equal(isArchivedEmulationSaveForGame(save, "ps2", "game-a"), true);
    assert.equal(isArchivedEmulationSaveForGame(save, "ps2", "game-b"), false);
    assert.equal(isArchivedEmulationSaveForGame(save, "ps1", "game-a"), false);
    assert.equal(
      isArchivedEmulationSaveForGame(
        { ...save, shop: "steam" },
        "ps2",
        "game-a"
      ),
      false
    );
  });

  it("keeps the save extension and removes path traversal", () => {
    assert.equal(
      sanitizeArchivedEmulationFileName("../../Other Game.psu"),
      "Other Game.psu"
    );
    assert.equal(
      sanitizeArchivedEmulationFileName("C:\\backup\\CON.mcs"),
      "_CON.mcs"
    );
    assert.equal(sanitizeArchivedEmulationFileName("\u0000"), "_");
  });

  it("exports linked and unlinked backups through the emulator archive", () => {
    assert.equal(
      isArchivedEmulationSaveForExport(save, "ps2", "pcsx2", "game-a"),
      true
    );
    assert.equal(
      isArchivedEmulationSaveForExport(save, "ps2", "pcsx2", "game-b"),
      false
    );
    assert.equal(
      isArchivedEmulationSaveForExport(save, "ps2", "pcsx2", null),
      true
    );
    assert.equal(
      isArchivedEmulationSaveForExport(
        { ...save, shop: null, objectId: null },
        "ps2",
        "pcsx2",
        null
      ),
      true
    );
    assert.equal(
      isArchivedEmulationSaveForExport(save, "ps1", "pcsx2", null),
      false
    );
  });
});
