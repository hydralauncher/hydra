import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPreparedForVersion,
  readInstallerEvent,
} from "./recompilation-prepare.js";

describe("readInstallerEvent", () => {
  it("reads a numbered step", () => {
    assert.deepEqual(readInstallerEvent("@step 2 5 Copying files", {}), {
      step: 2,
      steps: 5,
      title: "Copying files",
    });
  });

  it("adds a percent to the current step", () => {
    assert.deepEqual(
      readInstallerEvent("@note 40% done", { step: 2, steps: 5, title: "A" }),
      { step: 2, steps: 5, title: "A", percent: 40 }
    );
  });

  it("reads Crash Bandicoot's stage lines", () => {
    assert.deepEqual(readInstallerEvent("[ 35%] Recompile: overlay 3", {}), {
      percent: 35,
      title: "Recompile",
    });
    assert.deepEqual(readInstallerEvent("[100%] Done: ok", {}), {
      percent: 100,
      title: "Done",
    });
  });

  it("ignores any other line", () => {
    assert.equal(readInstallerEvent("Loading disc image", {}), null);
  });
});

describe("isPreparedForVersion", () => {
  const meta = { prepareOnUpdate: true };
  const choice = { preparedFrom: "/roms/crash.cue", preparedVersion: "2.4" };

  it("is ready for the ROM and version it was prepared for", () => {
    assert.equal(
      isPreparedForVersion(meta, choice, "/roms/crash.cue", "2.4"),
      true
    );
  });

  it("needs a new preparation after an update", () => {
    assert.equal(
      isPreparedForVersion(meta, choice, "/roms/crash.cue", "2.5"),
      false
    );
  });

  it("needs a new preparation for another ROM", () => {
    assert.equal(
      isPreparedForVersion(meta, choice, "/roms/other.cue", "2.4"),
      false
    );
  });

  it("never applies to ports prepared only once", () => {
    assert.equal(
      isPreparedForVersion({}, choice, "/roms/crash.cue", "2.4"),
      false
    );
  });
});
