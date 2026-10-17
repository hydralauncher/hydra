import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { retroArchSaveLocationsOverlap } from "./retroarch-save-collision.js";

describe("RetroArch save collisions", () => {
  const root = path.join(path.sep, "home", "user", "RetroArch");
  const nes = {
    romPath: path.join(root, "roms", "nes", "Tetris.nes"),
    saveDirectory: path.join(root, "saves", "FCEUmm"),
    stateDirectory: path.join(root, "states", "FCEUmm"),
  };
  const gb = {
    romPath: path.join(root, "roms", "gb", "Tetris.gb"),
    saveDirectory: path.join(root, "saves", "Gambatte"),
    stateDirectory: path.join(root, "states", "Gambatte"),
  };

  it("allows the same ROM name when core directories differ", () => {
    assert.equal(retroArchSaveLocationsOverlap(nes, gb), false);
  });

  it("blocks shared battery or state targets", () => {
    assert.equal(
      retroArchSaveLocationsOverlap(nes, {
        ...gb,
        saveDirectory: nes.saveDirectory,
      }),
      true
    );
    assert.equal(
      retroArchSaveLocationsOverlap(nes, {
        ...gb,
        stateDirectory: nes.stateDirectory,
      }),
      true
    );
  });
});
