import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getRestoreModalCopyKeys } from "./emulation-save-modal-copy.js";

describe("emulation save restore modal copy", () => {
  it("explains the manual Dolphin import flow for Wii saves", () => {
    assert.deepEqual(getRestoreModalCopyKeys("wii"), {
      title: "cloud_restore_wii_title",
      description: "cloud_restore_wii_description",
      confirm: "cloud_restore_wii_confirm",
    });
  });

  it("keeps direct emulator restores separate from memory card restores", () => {
    assert.equal(
      getRestoreModalCopyKeys("psp").description,
      "cloud_restore_emulator_description"
    );
    assert.equal(
      getRestoreModalCopyKeys("gamecube").description,
      "cloud_restore_emulator_description"
    );
    assert.equal(
      getRestoreModalCopyKeys("ps2").description,
      "cloud_restore_description"
    );
  });
});
