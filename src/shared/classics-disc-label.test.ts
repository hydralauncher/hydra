import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getClassicsDiscLabel,
  stripFileExtension,
} from "./classics-disc-label.js";

describe("classics disc label", () => {
  it("shows the executable file name without its extension", () => {
    assert.equal(
      getClassicsDiscLabel({
        label: "Executable",
        fileName: "YGP Launcher.lnk",
        isExecutable: true,
      }),
      "YGP Launcher"
    );
  });

  it("keeps the disc label for ROMs", () => {
    assert.equal(
      getClassicsDiscLabel({ label: "Disc 1", fileName: "game.cue" }),
      "Disc 1"
    );
  });

  it("strips only the last extension and keeps dotfiles intact", () => {
    assert.equal(stripFileExtension("game.v1.2.exe"), "game.v1.2");
    assert.equal(stripFileExtension("launcher"), "launcher");
    assert.equal(stripFileExtension(".hidden"), ".hidden");
  });
});
