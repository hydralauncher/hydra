import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getLocalSaveDeviceLabel } from "./game-emulation-save-presentation.js";

describe("local emulator save presentation", () => {
  it("shows the current device name instead of the emulator storage label", () => {
    assert.equal(
      getLocalSaveDeviceLabel({
        hostname: "CachyOS-PCVictor",
        cardLabel: "SAVEDATA",
      }),
      "CachyOS-PCVictor"
    );
  });

  it("keeps the storage label for records created before hostnames were added", () => {
    assert.equal(
      getLocalSaveDeviceLabel({ cardLabel: "Mcd001.ps2" }),
      "Mcd001.ps2"
    );
  });
});
