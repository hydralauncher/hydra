import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findSelectedExecutableDisc,
  mergeScannedDiscs,
} from "./classics-executable-disc.js";

const rom = { path: "/roms/game.iso", label: "Disc 1", fileName: "game.iso" };
const executable = {
  path: "/ports/game.exe",
  label: "Executable",
  fileName: "game.exe",
  isExecutable: true,
};

describe("classics executable disc", () => {
  it("launches the executable when it is the requested entry", () => {
    assert.equal(
      findSelectedExecutableDisc([rom, executable], executable.path, rom.path),
      executable
    );
  });

  it("uses the selected entry when nothing is requested", () => {
    assert.equal(
      findSelectedExecutableDisc([rom, executable], undefined, executable.path),
      executable
    );
    assert.equal(
      findSelectedExecutableDisc([rom, executable], undefined, rom.path),
      null
    );
  });

  it("falls back to the first entry without a selection", () => {
    assert.equal(
      findSelectedExecutableDisc([executable, rom], undefined, undefined),
      executable
    );
  });

  it("returns nothing for games without entries", () => {
    assert.equal(findSelectedExecutableDisc([], undefined, undefined), null);
    assert.equal(
      findSelectedExecutableDisc(undefined, undefined, undefined),
      null
    );
  });

  it("keeps added executables when a rescan replaces the ROM list", () => {
    const rescannedRom = { ...rom, label: "Disc 1 (rescanned)" };

    assert.deepEqual(mergeScannedDiscs([rescannedRom], [rom, executable]), [
      rescannedRom,
      executable,
    ]);
  });

  it("prefers the scanned entry when an executable path was rescanned", () => {
    const scannedExecutable = { ...executable, isExecutable: undefined };

    assert.deepEqual(mergeScannedDiscs([scannedExecutable], [executable]), [
      scannedExecutable,
    ]);
  });
});
