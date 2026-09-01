import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { platformToSystem } from "./platform-to-system.js";

describe("platformToSystem", () => {
  it("routes PSP before the generic PlayStation matcher", () => {
    assert.equal(platformToSystem("Sony PlayStation Portable"), "psp");
  });

  it("routes both supported platforms to Dolphin", () => {
    assert.equal(platformToSystem("Nintendo GameCube"), "dolphin");
    assert.equal(platformToSystem("Nintendo Wii"), "dolphin");
    assert.equal(platformToSystem("Nintendo Wii U"), null);
  });
});
