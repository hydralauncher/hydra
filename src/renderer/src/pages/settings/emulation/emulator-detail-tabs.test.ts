import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { availableEmulatorTabs } from "./emulator-detail-tabs.js";

describe("emulator detail tabs", () => {
  it("shows file saves for PPSSPP and Dolphin", () => {
    for (const system of ["psp", "dolphin"] as const) {
      const tabs = availableEmulatorTabs(system);
      assert.ok(tabs.includes("saves"));
      assert.ok(!tabs.includes("memory-cards"));
    }
  });

  it("keeps memory card backups exclusive to PS1 and PS2", () => {
    for (const system of ["ps1", "ps2"] as const) {
      const tabs = availableEmulatorTabs(system);
      assert.ok(tabs.includes("memory-cards"));
      assert.ok(!tabs.includes("saves"));
    }
  });

  it("does not show save tabs for unsupported systems", () => {
    const tabs = availableEmulatorTabs("ps3");
    assert.ok(!tabs.includes("memory-cards"));
    assert.ok(!tabs.includes("saves"));
  });
});
